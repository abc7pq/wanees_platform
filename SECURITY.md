# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** button on this repository (Security → Advisories). Do not open a public issue for a security problem. You will get an answer within a few days.

## What the project does to stay safe

- **No secrets in the repository.** Provider keys and database URLs live only in ignored `.env` files on the server. CI fails if a provider key pattern appears in any tracked file.
- **Visitors are anonymous.** A random session token, stored hashed, in an `HttpOnly; SameSite=Lax` cookie (`Secure` in production). No name, phone number or account is needed. Assistant turns are redacted and expire after 24 hours; raw audio is never stored.
- **Organizers sign in** with scrypt-hashed passwords. Every organizer query is scoped to its organization and event, and every live update is audited.
- **The language model cannot change a plan.** Stops, prices and times come from the deterministic engine and the published catalog. Visitor text and event content reach the model as untrusted data, with contact details removed first.
- **Abuse limits.** Session, assistant and directions endpoints are rate-limited, keyed on the client address behind a configured number of trusted proxies.
- **Backups** are encrypted with AES-256-GCM, and a restore is rehearsed in CI.

## Deployment checklist

- Set `WANEES_TRUSTED_PROXY_HOPS` to the number of reverse proxies in front of the apps, and do not expose the app ports directly.
- Leave `ADMIN_TOKEN`, `WANEES_LOCAL_DEMO`, `WANEES_DEMO_ADMIN_PASSWORD`, `WANEES_ALLOW_CLOCK_OVERRIDE` and `WANEES_CLOCK_OVERRIDE_MINUTE` unset in production.
- Use a long random `WANEES_RATE_LIMIT_SALT` and `WANEES_BACKUP_ENCRYPTION_PASSPHRASE`.
- See `docs/OPERATIONS_RUNBOOK.md` for the full list.
