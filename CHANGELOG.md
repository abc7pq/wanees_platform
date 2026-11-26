# Changelog

All notable changes to WANEES. Dates are in Asia/Riyadh time.

## Unreleased

### Engineering audit — phase 1 (talk to Wanees, no surveys)

- The first screen is a conversation: «هلا والله! قل لي وش بالك الليلة», a message box with a mic
  button and example chips («معي عيالي»، «طلعة شباب»، «عندي ساعتين بس»، «أبي شي هادي») that only
  type a sentence. No quiz on the first visit. The first message starts the visit and a plan appears
  at once, with its defaults as tappable chips («3 ساعات · بدون رعب · ميزانية متوسطة»).
- Every message is understood (`app/lib/visitor-understanding.ts`): party, each child's age, likes per
  person mapped to controlled tags, unmatched interests, things to avoid, budget, time, mood,
  mobility and reply language. A deterministic Saudi-dialect parser covers it without a key; with a
  key the model may add facts only when it quotes the visitor's own words (zod-validated, 3 s).
- New facts re-plan: directly before the visit starts, as a proposal after. At most one question, only
  when it changes safety or the plan (the youngest child's age).
- Activities carry descriptions, controlled tags (طيران، حيوانات، سيارات، أنمي، كورة، رعب…) and
  highlights. Organizers edit them; suggested tags wait for approval. The catalog build fails for an
  active activity without a description or with fewer than 3 tags.
- Matching ranks by each person's likes and gives the engine's reason («لأن ولدك يحب الطيران»). Nothing
  above the youngest child's age limit is offered as a fit; horror only when asked for; with ages
  unknown, no age-limited or horror items. With no match it says so and offers the closest option.
- Categories are a hard filter: «ابي مطعم», «وين المطاعم», «انا عند جناح افريقيا، دلني على المطاعم»
  return only restaurants, nearest first by walking minutes from the place the visitor named.
- Follow-ups: «وكم سعرها؟» answers about the last suggestion, «كم الزحمة الحين؟» is a crowd question,
  and «تعبت ابي اقعد» is a new `rest` intent (nearest seating or calm spots, and an offer to shorten).
- Replies follow the visitor's language (Arabic by default; English, French and Urdu on a full
  message), facts carry `name_en`, and the grounding guard accepts either name.
- Persona v5 (`wanees-agent-v5`) with `<reply_language>`, `<visitor_position>` and `<channel>`.
- The agent eval passes 43/43 without the AI key (37 before).

### Engineering audit — phase 0 (live walking)

- One database pool per server process. The visitor app opened two pools of up to 30 connections (its own
  client and the engine's), outside a process-wide singleton in production, and warmed 24 connections at boot.
  Four servers on one database ran PostgreSQL out of connections ("too many clients already"), which reached
  visitors as «الفعالية غير متاحة» and empty 500s. Every Prisma module now reuses one client per process, sized
  by `WANEES_DB_POOL_MAX` (default 20); the boot warm-up opens at most 8.
- `generateVapidKeys` dropped a leading zero byte, so one private key in 256 came out 31 bytes and was rejected. It is now
  always 32 bytes.
- Live GPS guidance is now a venue setting with a GPS calibration (anchor, metres per unit,
  rotation), map accuracy and a staff simulation switch. Organizers edit it in «التوجيه وGPS»;
  every change is audited (`venue.navigation_change`). Boulevard World is seeded calibrated
  with live guidance on and `APPROXIMATE` accuracy.
- The phone's GPS snaps to the walkway graph with the venue's calibration (rotation included);
  fixes up to 150 m are used and approximate ones are flagged. Guides on an approximate map tell
  the visitor to follow site signs too.
- The illustrated park art, weather and presence sensing no longer assume Boulevard World; any
  calibrated venue gets a satellite map, weather and crowd sensing.
- Arabic counted nouns agree with the number everywhere (دقيقة، دقيقتين، 3 دقائق، 11 دقيقة،
  محطة، شخص), from one helper (`app/lib/ar-count.ts`).
- CI checks that `schema.prisma` matches the migrations (`npm run db:drift`).
- `GuestProfile.updatedAt` gets a default and `IdempotencyRecord` an event index.

- Closed the twelve open items of the [2026-11-26 audit](docs/AUDIT_2026-11-26.md) (section 6):
  organizer users and audit-log pages, event lifecycle (draft → published → live → completed → archived),
  analytics by zone, hour and party type with small-count suppression, a globally unique event slug,
  organization-scoped guest profiles, race-free visit history, per-person price labels, phone map zoom,
  an on-demand map and assistant bundle, an organizer section on the landing page, a catalog
  duplicate guard, and a visitor copy guide.
- Archived events are read-only for organizers (409 `EVENT_ARCHIVED`) until restored to draft.
- An invited member's one-time password no longer opens a session; the first sign-in sets a new
  password (12+ characters, not the one-time one, not containing the email).
- Analytics breakdowns hide the smallest other buckets alongside any bucket under 5 and label all
  of them «مخفي», so totals minus visible buckets can no longer reveal a small count.
- `/api/v1/guest` takes `?eventSlug=`; `POST` now requires it, and requests without it fail with
  409 `GUEST_PROFILE_AMBIGUOUS` when a browser has profiles at more than one organization.
- Landing page and metadata no longer describe WANEES as a hackathon entry; the phone mockups
  use real 2026 activities, the real first question and proposal buttons, and Western digits.
- Assistant walking directions say «من البوابة» before the visit starts instead of naming the
  entrance zone as if the visitor were standing in it.
- Seed data records the 2026-27 season catalog (`boulevard_world_2026.json`) as its source.
- Documentation index, contributing guide, this changelog, and the
  [2026-11-26 audit](docs/AUDIT_2026-11-26.md). Hackathon-era documents moved to `docs/archive/`.

## 2026-11-26

### Removed
- Third-party ticket-seller prices, their price note and the verified-price markers (PR #7).
  The published catalog now has 90 activities.

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
