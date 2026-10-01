# TIKIT Privacy Policy

*Last updated 1 October 2026. English version of the Norwegian [personvernerklaering.md](personvernerklaering.md). If the two differ, the Norwegian version applies.*

> **Before publishing:** fill in the [bracketed] fields and have an adviser review the text. It reflects how TIKIT actually works, but it is not legal advice.

## 1. Who is responsible

**Din Russetid AS** (org. no. 936 491 243), [address], is the data controller for personal data in TIKIT. Contact us at [support e-mail] about anything related to privacy.

The organizer of each event is an independent controller for the data they receive about attendees of their own event (see section 4).

## 2. What we process

**From the sign-in you choose**
- **Vipps:** name, e-mail, mobile number and date of birth. Name and date of birth come from the Norwegian National Population Register via Vipps and are therefore treated as verified.
- **Google:** name and e-mail.
- **Apple:** name (first sign-in only) and e-mail, which may be a private relay address from Apple.

We never receive your password.

**When you use TIKIT**
- Profile: the city you pick and which notifications you want.
- Purchases: orders, amounts, discount codes, the payment reference at Vipps or Stripe (never card numbers), receipts and refunds.
- Tickets: the name on the ticket, seat, transfers (the recipient's e-mail or phone number and an optional note) and resale.
- Queue place, waitlist, sale alerts, favourites, organizers you follow and organizers you have hidden.
- Reports about content: the reason, the description and who sent the report if they were signed in.
- Check-in: when a ticket was scanned, at which entrance and by whom.
- Technical: a sign-in session (stored as a cryptographic hash), the name and version of the browser or app for that session, and your IP address briefly to limit abuse (not stored).
- If you sign in with Apple: an encrypted token from Apple, used only to revoke TIKIT's access at Apple when you delete your account.

**For organizers** also: organizer details, team members and the bank account for payouts.

## 3. Why, and our legal basis

| Purpose | Legal basis (GDPR Art. 6) |
| --- | --- |
| Account, delivering tickets and receipts, transfers, resale and refunds | Contract (b) |
| Checking age limits set by the organizer | Contract (b), and the organizer's duty to enforce age limits |
| Preventing fraud, bulk buying and abuse; keeping the service secure | Legitimate interests (f) |
| Keeping sales records | Legal obligation (c) – Norwegian Bookkeeping Act |
| Tips and news by e-mail | Consent (a) – withdraw it any time under Profile → Notifications |

We never sell data or use it for advertising or profiling. The only automated decision is that a purchase for an age-restricted event is declined when your age is below the limit.

## 4. Who receives data

- **The organizer** of an event you bought tickets for receives the buyer's name and contact details and the names on the tickets. They use them to run the event and control entry. Door staff only see name, ticket type and whether the age is verified.
- **The recipient** of a ticket you transfer sees your name and your note.
- **Processors acting on our behalf:** hosting and operations (Render, servers in Frankfurt, with network services from Cloudflare), database (Supabase, servers in the EU – [remove if Supabase is not used]) and e-mail delivery (Resend).
- **Independent services you choose to use:** Vipps MobilePay (sign-in and payment), Stripe (card payment), Google and Apple (sign-in). They process data under their own privacy policies.
- **Wallet, if you add your ticket:** the pass holds your name, the ticket number, the event and the QR code. An Apple Wallet pass is made by us and stored only on your device (and in iCloud if you use it). If you choose Google Wallet, the same details are sent to Google, which keeps the pass in your Google account under its own terms. Nothing is sent until you tap the button, and the pass expires after the event.
- **Authorities** where the law requires it.

## 5. Transfers outside the EEA

Some providers are US companies. Such transfers rely either on the provider's certification under the EU–US Data Privacy Framework or on the EU standard contractual clauses.

## 6. How long we keep data

| Data | Retention |
| --- | --- |
| Profile and sign-in methods | Until you delete your account |
| Orders (sales records) | Five years after the end of the financial year (Bookkeeping Act § 13), then anonymized |
| Names on tickets | One year after the event, then anonymized |
| Check-in log | One year after the event |
| Queue places, waitlists and sale alerts | 30 days after the event |
| Recipient contact details and note on transfers | 90 days |
| In-app notifications | One year |
| Sign-in session | 30 days without use |
| Audit log | Five years |
| Reports about content | One year after the report was handled |
| Hidden organizers | Until you show them again or delete your account |

If you delete your account, your profile, sign-in methods, favourites and notifications are removed at once. Orders are kept without name or contact details for as long as bookkeeping rules require. Deletion and anonymization run automatically every day.

## 7. Your rights

You have the right to:
- access your data
- correct it
- erase it
- restrict processing
- object to processing based on legitimate interests
- data portability
- withdraw consent

Under **Profile → Privacy and data** you can download all your data as a file and delete your account yourself. A name and date of birth verified through Vipps are corrected at Vipps / the population register. For anything else, write to [support e-mail]. We reply within one month.

You can complain to the Norwegian Data Protection Authority (**Datatilsynet**, datatilsynet.no).

## 8. Security

Everything is sent encrypted (HTTPS). The database is only reachable inside the hosting provider's network, and sign-in sessions are stored only as hashes. Sign-in happens at Vipps, Google or Apple. Card payments are handled by Stripe and Vipps, and TIKIT never sees card numbers. Organizer access is role-based. If a personal data breach occurs, we notify Datatilsynet within 72 hours, and you too if it is likely to put you at high risk.

## 9. Cookies and local storage

TIKIT only uses what is strictly necessary for the service you ask for. There are no tracking, analytics or advertising cookies. See [cookie-policy.en.md](cookie-policy.en.md) for the full list.

**The iOS app:** your sign-in is kept in the phone's Keychain (this device only), and tickets are stored in the app so they work offline. Everything is removed when you sign out. The app only asks for camera access, and only when you use the door scanner or take a picture for an event. The app does not track you and has no ads or analytics.

## 10. Changes

We update the date at the top when this policy changes, and announce material changes in the app.
