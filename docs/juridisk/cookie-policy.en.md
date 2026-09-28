# TIKIT Cookie and Local Storage Policy

*Last updated 28 September 2026.*

TIKIT only stores what is **strictly necessary** to provide the service you ask for: signing in, buying, tickets that work offline, and the door scanner. That is exempt from the consent requirement in the Norwegian Electronic Communications Act § 3-15, so there is no consent banner. We use no tracking, analytics, advertising or third-party cookies.

## Cookies

| Name | Purpose | Lifetime |
| --- | --- | --- |
| `tikit_sid` | Keeps you signed in. Not readable by JavaScript; sent over HTTPS only. | 30 days without use |
| `tikit_oauth` | Protects the sign-in while you are at Vipps, Google or Apple. | 10 minutes |

## Browser storage (localStorage and sessionStorage)

| Key | Purpose |
| --- | --- |
| `tikit-city` | The city you picked |
| `tikit-unlock` | Access codes you entered for hidden ticket types |
| `tikit-clock-offset` | The difference between your phone's clock and the server, so the QR code is correct |
| `tikit.lastUser` | Who was last signed in, so stored tickets are removed if someone else signs in on the same phone |
| `tikit-gate`, `tikit-scan-sound` | Door scanner settings (entrance and sound) |
| `tikit.scanQueue.*` | Check-ins made offline in the scanner. Removed when the tab closes or once they are synced. |

## Offline storage (service worker)

| Store | Contents | Lifetime |
| --- | --- | --- |
| App files | The app itself, so it opens quickly and works offline | Until the next version |
| `tikit-images` | Event poster images | 30 days |
| `tikit-tickets` | Your tickets and who is signed in, so a ticket can be shown at the door offline | 14 days. Removed on sign-out or when someone else signs in. |

You can clear all of this in your browser's site data settings. You will then be signed out, and tickets stored for offline use are gone until you open the app online again.

## The iOS app

The app does not use cookies for signing in. Instead:

| Storage | What it holds | Duration |
| --- | --- | --- |
| iOS Keychain | Your sign-in (a random token), on this device only | Until you sign out or delete the app |
| `tikit-offline:*` in the app | Your tickets and who is signed in, so a ticket can be shown at the door without coverage | 14 days. Removed when you sign out or someone else signs in. |
| `tikit.installed` | A flag that the app is installed, so an old sign-in from before the app was deleted is not reused | Until you delete the app |

The same settings as in the browser are used too (city, access codes, clock offset, scanner). You remove everything by signing out and deleting the app.

