# Changelog

All notable changes to WANEES. Dates are in Asia/Riyadh time.

## Unreleased

### Engineering audit — phases 2 and 3 (an app, and where the visitor is)

- Real screens with their own URLs: `/e/{slug}` is «ونيس», and `/plan`, `/map`, `/nearby`, `/me` are the
  other tabs. Back moves between them instead of leaving the app; a deep link opens the right tab.
  `/events/{slug}` redirects to `/e/{slug}` with its query, `/demo` stays as the rehearsal alias, and the
  installed app starts at `/e/boulevard-world-demo`. Push nudges may reopen any `/e/…` tab.
- A bottom navigation with five tabs (ونيس، مساري، الخريطة، حولي، أنا) on phones, with `aria-current`, a badge
  on «مساري» while a proposal waits, hidden while the keyboard is up or the compass guide or a call is open.
  On a laptop it is a side rail beside the plan and the open panel. After the first message the visitor
  lands on «مساري».
- Sheets: Back closes an open sheet, the grab handle drags it down or switches it to full height, and the
  page behind does not scroll. Escape, the focus trap and focus return stay as before.
- Toasts with «تراجع», loading skeletons, a light haptic on tab change, and an install hint in «أنا»
  (Android prompt, or the two taps on iPhone).
- «حولي»: one tap to the nearest toilets, food, prayer room, first aid, information or seating, three results
  by real walking minutes, each with «دلّني» and «على الخريطة» (`GET /api/v1/events/{slug}/nearby`).
- «أنا»: what Wanees understood about this visit (all from the visitor's own words), the reply language
  (`PATCH /session`), privacy, and deleting the visit.
- Where the visitor is (`app/lib/visitor-position.ts`): the phone snaps GPS to the walkway graph and sends
  only the node id. The server accepts it when the node is on this event's open graph, GPS is under two
  minutes old and within 150 m; a spoken «انا عند …» lasts 20 minutes; a kiosk never moves. A refused
  position is reported (`positionRejected`), never used. Replies and «حولي» say where minutes are counted from.
- GPS in a crowd: fixes up to 150 m count as approximate, a jump faster than walking is ignored, and a timed-out
  fix is retried once. Staff and demo mode: `?gps=simulate&at=<nodeId>`.
- Activities can name their entrance node (`Activity.entranceNodeKey`, migration `20261127120000_activity_entrance`);
  directions end at the door. Organizers pick it per activity; the real entrances need the on-site survey.
- Step-free routing: a visitor who said wheelchair or stroller gets accessible walkways only, or a clear
  «ما لقيت طريق بدون درج» with a pointer to visitor services, never a guessed route.
- Tests: `tests/ui/app-shell.spec.mjs` (375 px nav, URLs, Back, sheets, «حولي» from a simulated position,
  language undo), `app/lib/visitor-position-test.mjs`, step-free routing in the walkway graph test, and HTTP
  checks for «حولي», GPS, foreign and stale nodes, spoken position and the reply language.

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
