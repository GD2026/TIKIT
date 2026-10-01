# Integrasjoner

Én mappe per leverandør. Hver fil implementerer et grensesnitt fra `src/server/adapters/types.ts`, og `src/node/server.ts` kobler dem inn når nøklene finnes. Resten av koden vet ikke hvilken leverandør som brukes. I demo og tester erstattes de av `src/server/adapters/demo.ts`.

| Mappe | Grensesnitt | Nøkler (`.env`) | Oppsett |
| --- | --- | --- | --- |
| `vipps/login.ts` | `OAuthAdapter` | `VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY`, `VIPPS_MSN` | [oppsett.md §2](../../../docs/oppsett.md#2-vipps-mobilepay-innlogging--betaling) |
| `vipps/payments.ts` | `PaymentAdapter` (ePayment + webhook) | samme + `VIPPS_WEBHOOK_SECRET` | samme |
| `vipps/common.ts` | tilgangsnøkkel og systemheadere | – | – |
| `google/login.ts` | `OAuthAdapter` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | [§3](../../../docs/oppsett.md#3-google) |
| `apple/login.ts` | `OAuthAdapter` (nettsiden, form_post) | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | [§4](../../../docs/oppsett.md#4-sign-in-with-apple) |
| `apple/native.ts` | `AppleNativeAdapter` (iOS-knappen, tilbakekalling) | `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_BUNDLE_IDS` | [ios.md](../../../docs/ios.md) |
| `apple/clientSecret.ts` | ES256-klienthemmelighet for Apple | – | – |
| `apple/wallet.ts` | `WalletAdapter.apple`: signert `.pkpass` (Apple Wallet) | `APPLE_WALLET_CERT`, `APPLE_WALLET_KEY` | [§9](../../../docs/oppsett.md#9-lommebok-apple-wallet-og-google-wallet) |
| `apple/wwdr.ts` | Apples offentlige WWDR G4-mellomsertifikat | – | – |
| `google/wallet.ts` | `WalletAdapter.google`: «Lagre i Google Lommebok»-lenke | `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT` | [§9](../../../docs/oppsett.md#9-lommebok-apple-wallet-og-google-wallet) |
| `stripe/payments.ts` | `PaymentAdapter` (Checkout + webhook) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | [§5](../../../docs/oppsett.md#5-kortbetaling-stripe) |
| `resend/mailer.ts` | `Mailer` | `RESEND_API_KEY`, `MAIL_FROM` | [§6](../../../docs/oppsett.md#6-e-post-resend) |
| `zip.ts` | ZIP-arkiv for `.pkpass` | – | – |
| `oidc.ts`, `shared.ts` | Felles hjelpere (telefonformat, callback-URL, idempotensnøkler, sammenligning i konstant tid) | – | – |

Databasen (Supabase, Render Postgres, PGlite) ligger i `../db/`.

**Ny leverandør:** lag `<navn>/…ts` som implementerer riktig grensesnitt, legg nøklene i `src/node/config.ts`, koble den inn i `src/node/server.ts`, og legg den til i `.env.example`, `render*.yaml` og `scripts/doctor.ts`.
