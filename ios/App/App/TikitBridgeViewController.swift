import UIKit
import Capacitor

/// The app's root view controller: Capacitor's web view with the TIKIT web app, plus TIKIT's own plugin
/// (TikitNativePlugin.swift), which lives in the app rather than in an npm package.
class TikitBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TikitNativePlugin())
    }
}
