import { SignJWT, importPKCS8 } from 'jose';

export interface AppleKeyConfig {
  /** Team ID (Apple Developer → Membership details). */
  teamId: string;
  /** ID of the Sign in with Apple key. */
  keyId: string;
  /** Contents of the AuthKey_XXXX.p8 file (PEM, PKCS#8); `\n` escapes are accepted. */
  privateKey: string;
}

/**
 * Apple's token endpoints take a client secret that is an ES256 JWT signed with the Sign in with Apple key.
 * Apple accepts secrets valid for up to six months; we use 30 days and renew an hour early.
 * `clientId` is the Services ID for the web flow and the app's bundle ID for the native iOS flow.
 */
export function createAppleClientSecret(cfg: AppleKeyConfig, clientId: string): () => Promise<string> {
  let key: ReturnType<typeof importPKCS8> | null = null;
  let secret = '';
  let expires = 0;
  return async () => {
    const now = Math.floor(Date.now() / 1000);
    if (secret && now < expires - 3600) return secret;
    key ??= importPKCS8(cfg.privateKey.replace(/\\n/g, '\n'), 'ES256');
    const exp = now + 30 * 86400;
    secret = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
      .setIssuer(cfg.teamId)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .setAudience('https://appleid.apple.com')
      .setSubject(clientId)
      .sign(await key);
    expires = exp;
    return secret;
  };
}
