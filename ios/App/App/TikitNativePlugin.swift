import Foundation
import Capacitor
import AuthenticationServices
import CryptoKit
import PassKit
import Security

/// TIKIT's own native features for the web app. The TypeScript side is src/web/native/plugin.ts.
///
///  - authenticate:      logins in ASWebAuthenticationSession (Google refuses logins in an app's own web view)
///  - signInWithApple:   the native «Logg på med Apple» sheet (App Store Review Guideline 4.8)
///  - get/set/clearSession: the session token, kept in the Keychain on this device only
///  - sha256:            hashing, in case Web Crypto isn't available in the web view
///  - addWalletPass:     Apple's «Legg til i Lommebok» sheet for a ticket (.pkpass from the server)
@objc(TikitNativePlugin)
public class TikitNativePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding, PKAddPassesViewControllerDelegate {
    public let identifier = "TikitNativePlugin"
    public let jsName = "TikitNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sha256", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addWalletPass", returnType: CAPPluginReturnPromise)
    ]

    private var webSession: ASWebAuthenticationSession?
    private var appleController: ASAuthorizationController?
    private var appleCall: CAPPluginCall?
    private var walletCall: CAPPluginCall?
    private var walletPass: PKPass?

    override public func load() {
        // Keychain items outlive the app. A fresh install must not sign in as whoever used the app before.
        let installedKey = "tikit.installed"
        if !UserDefaults.standard.bool(forKey: installedKey) {
            Keychain.delete()
            UserDefaults.standard.set(true, forKey: installedKey)
        }
    }

    // MARK: - Login in the system browser

    @objc func authenticate(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https" || url.host == "localhost",
              let scheme = call.getString("callbackScheme"), !scheme.isEmpty else {
            call.reject("url og callbackScheme mangler", "INVALID")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.webSession = nil
                if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.reject("Innloggingen ble avbrutt", "CANCELLED")
                    return
                }
                if let error = error {
                    call.reject(error.localizedDescription, "FAILED")
                    return
                }
                guard let callbackURL = callbackURL else {
                    call.reject("Innloggingen ga ikke noe svar", "FAILED")
                    return
                }
                call.resolve(["url": callbackURL.absoluteString])
            }
            session.presentationContextProvider = self
            // Shares Safari's cookies, so someone already signed in to Google or Apple there doesn't have to type again.
            session.prefersEphemeralWebBrowserSession = false
            self.webSession = session
            if !session.start() {
                self.webSession = nil
                call.reject("Kunne ikke åpne innloggingen", "FAILED")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return anchor()
    }

    // MARK: - Sign in with Apple

    @objc func signInWithApple(_ call: CAPPluginCall) {
        guard let nonce = call.getString("nonce"), !nonce.isEmpty else {
            call.reject("nonce mangler", "INVALID")
            return
        }
        DispatchQueue.main.async {
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            // Apple puts this value in the identity token; the server checks it against its own nonce.
            request.nonce = Self.sha256Hex(nonce)
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.appleCall = call
            self.appleController = controller
            controller.performRequests()
        }
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = appleCall else { return }
        appleCall = nil
        appleController = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple svarte uten innloggingsbevis", "FAILED")
            return
        }
        var result: [String: Any] = ["identityToken": identityToken]
        if let codeData = credential.authorizationCode, let code = String(data: codeData, encoding: .utf8) {
            result["authorizationCode"] = code
        }
        // Apple only sends the name the very first time someone signs in to the app.
        if let given = credential.fullName?.givenName { result["givenName"] = given }
        if let family = credential.fullName?.familyName { result["familyName"] = family }
        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = appleCall else { return }
        appleCall = nil
        appleController = nil
        if let error = error as? ASAuthorizationError, error.code == .canceled {
            call.reject("Innloggingen ble avbrutt", "CANCELLED")
            return
        }
        call.reject(error.localizedDescription, "FAILED")
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return anchor()
    }

    // MARK: - Session token in the Keychain

    @objc func getSession(_ call: CAPPluginCall) {
        if let token = Keychain.read() {
            call.resolve(["token": token])
        } else {
            call.resolve([:])
        }
    }

    @objc func setSession(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("token mangler", "INVALID")
            return
        }
        if Keychain.write(token) {
            call.resolve()
        } else {
            call.reject("Kunne ikke lagre innloggingen", "FAILED")
        }
    }

    @objc func clearSession(_ call: CAPPluginCall) {
        Keychain.delete()
        call.resolve()
    }

    // MARK: - Hashing

    @objc func sha256(_ call: CAPPluginCall) {
        guard let value = call.getString("value") else {
            call.reject("value mangler", "INVALID")
            return
        }
        let digest = Data(SHA256.hash(data: Data(value.utf8)))
        let base64url = digest.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        call.resolve(["base64url": base64url])
    }

    // MARK: - Apple Wallet

    @objc func addWalletPass(_ call: CAPPluginCall) {
        guard let base64 = call.getString("data"), let data = Data(base64Encoded: base64) else {
            call.reject("data mangler", "INVALID")
            return
        }
        DispatchQueue.main.async {
            guard PKAddPassesViewController.canAddPasses() else {
                call.reject("Lommebok er ikke tilgjengelig på denne enheten", "UNAVAILABLE")
                return
            }
            let pass: PKPass
            do {
                pass = try PKPass(data: data)
            } catch {
                call.reject("Billettkortet kunne ikke leses", "INVALID")
                return
            }
            if PKPassLibrary().containsPass(pass) {
                call.resolve(["added": true])
                return
            }
            guard let controller = PKAddPassesViewController(pass: pass), let presenter = self.bridge?.viewController else {
                call.reject("Kunne ikke åpne Lommebok", "FAILED")
                return
            }
            controller.delegate = self
            self.walletCall = call
            self.walletPass = pass
            presenter.present(controller, animated: true)
        }
    }

    public func addPassesViewControllerDidFinish(_ controller: PKAddPassesViewController) {
        let call = walletCall
        let pass = walletPass
        walletCall = nil
        walletPass = nil
        controller.dismiss(animated: true) {
            // «Avbryt» and «Legg til» both end here; the library tells which one it was.
            let added = pass.map { PKPassLibrary().containsPass($0) } ?? false
            call?.resolve(["added": added])
        }
    }

    // MARK: - Helpers

    private func anchor() -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    private static func sha256Hex(_ value: String) -> String {
        return SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// The session token as a generic password item: this device only, readable after the first unlock
/// (so a ticket can be shown while the phone is locked in a pocket and then unlocked at the door).
private enum Keychain {
    private static let service = (Bundle.main.bundleIdentifier ?? "no.tikit.app") + ".session"
    private static let account = "session"

    private static var base: [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func read() -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String) -> Bool {
        SecItemDelete(base as CFDictionary)
        var item = base
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func delete() {
        SecItemDelete(base as CFDictionary)
    }
}
