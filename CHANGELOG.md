# Changelog

All notable changes to WANEES. Dates are in Asia/Riyadh time.

## Unreleased

- Landing page and metadata no longer describe WANEES as a hackathon entry; the phone mockups
  use real 2026 activities, the real first question and proposal buttons, and Western digits.
- Assistant walking directions say «من البوابة» before the visit starts instead of naming the
  entrance zone as if the visitor were standing in it.
- Seed data records the 2026-27 season catalog (`boulevard_world_2026.json`) as its source.
- Documentation index, contributing guide, this changelog, and the
  [2026-11-26 audit](docs/AUDIT_2026-11-26.md). Hackathon-era documents moved to `docs/archive/`.

## 2026-11-26

### Removed
- Prices sourced from webook, the «أسعار مؤكدة من webook» note and the verified-price markers
  (PR #7). The published catalog now has 90 activities and no webook source.

### Added
- Optional registered visitors behind `WANEES_FEATURE_VISITOR_REGISTRATION` (off by default):
  name and Saudi mobile verified by SMS (Twilio Verify), versioned consent, HttpOnly device
  cookie, «لست أنا» and «احذف بياناتي», organizer visitor list with masked phones and audited
  reveal, CSV export, retention in `db:cleanup` (PR #6).
- Per-phone SMS budget in the database, login-CSRF guard on OTP routes, test SMS provider limited
  to loopback and refused in production unless explicitly allowed.

### Changed
- Visitor app: party totals survive reloads, confirmation dialogs, service worker purges old
  caches, Arabic count grammar, operator link only on `/demo`, minimum 12px text.
- Organizer app: same-origin checks and rate limits on writes, global event slug check, help
  queue sorts lost-child reports first, session expiry redirects to login, Arabic labels.
- The public login page shows demo credentials only when `WANEES_PUBLIC_DEMO_*` is configured and
  the account is read-only (VIEWER in every organization); otherwise the panel is hidden.
- Legacy `/api/session` and `/api/admin/broadcast` are rate-limited and validated.
- Removed unused admin routes, components and about 5 MB of unreferenced media.

### Earlier
- WANEES visual identity applied across both apps; Hetzner production deployment documented;
  initial release of the visitor guide, organizer dashboard, deterministic planner and grounded
  assistant.
