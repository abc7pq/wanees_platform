# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** button on this repository (Security → Advisories). Do not open a public issue for a security problem. You will get an answer within a few days.

## What the project does to stay safe

- **No secrets in the repository.** Provider keys and database URLs live only in ignored `.env` files on the server. CI fails if a provider key pattern appears in any tracked file.
- **Visitors are anonymous by default.** A random session token, stored hashed, in an `HttpOnly; SameSite=Lax` cookie (`Secure` in production). No name, phone number or account is needed. Assistant turns are redacted and expire after 24 hours; raw audio is never stored by WANEES servers.
- **Optional visitor registration.** An organizer can turn on `WANEES_FEATURE_VISITOR_REGISTRATION` (off by default) to require a name and an SMS-verified phone number (Twilio Verify) before a visit. The visitor accepts a versioned consent text; WANEES never stores or logs the SMS code; registered names and phone numbers are never sent to the language model; and `npm run db:cleanup` deletes a registered visitor after `WANEES_RETENTION_VISITOR_DAYS` (default 365) without a visit.
- **Organizers sign in** with scrypt-hashed passwords. Every organizer query is scoped to its organization and event, and every live update is audited.
- **The language model cannot change a plan.** Stops, prices and times come from the deterministic engine and the published catalog. Visitor text and event content reach the model as untrusted data. In text chat, email addresses and Saudi mobile numbers in a simple format are redacted first (`redactConversationText`); this is pattern-based and does not catch every format. In a voice call the visitor's raw audio goes from the browser directly to OpenAI Realtime with no redaction. See `docs/privacy/llm-data-flow.md`.
- **Abuse limits.** Session, assistant and directions endpoints are rate-limited, keyed on the client address behind a configured number of trusted proxies.
- **Backups** are encrypted with AES-256-GCM, and a restore is rehearsed in CI.

## Deployment checklist

- Set `WANEES_TRUSTED_PROXY_HOPS` to the number of reverse proxies in front of the apps, and do not expose the app ports directly.
- Leave `ADMIN_TOKEN`, `WANEES_LOCAL_DEMO`, `WANEES_DEMO_ADMIN_PASSWORD`, `WANEES_ALLOW_CLOCK_OVERRIDE`, `WANEES_CLOCK_OVERRIDE_MINUTE`, `WANEES_TEST_OTP_CODE` and `WANEES_ALLOW_TEST_SMS` unset in production.
- `WANEES_PUBLIC_DEMO_EMAIL` / `WANEES_PUBLIC_DEMO_PASSWORD` print a password on the public admin login page. The panel is shown only for an active account whose memberships are all `VIEWER`; remove both values and rotate the password after the demo period.
- Use a long random `WANEES_RATE_LIMIT_SALT` and `WANEES_BACKUP_ENCRYPTION_PASSPHRASE`.
- See `docs/OPERATIONS_RUNBOOK.md` for the full list.
