# Changelog

All notable changes to WANEES. Dates are in Asia/Riyadh time.

## Unreleased

### Phone-app experience: talk instead of a questionnaire

- The five-question picker is gone from the visitor app. Every way into a plan is a sentence: the opening chat,
  one tap on «إيه، نفس الجو» or «ابدأ بذوقك السابق» for a returning visitor (built straight from the saved
  preferences), and a visit that has to register first, which keeps the sentence and builds the plan as soon as
  registration completes. Without PostgreSQL, the legacy `/demo` reads the same sentence with the deterministic
  `understandMessage` on the device and builds the in-memory demo plan from it. The optional start point moved
  next to the message box. The home page now shows a chat, not «سؤال 1 من 5».
- Every stop in «مساري» has a ⋯ menu in a bottom sheet: walking directions, show on the map, «ليش هذي المحطة؟»,
  swap, remove and share. Swap, remove and «why» go through the assistant, so a change is still proposed and the
  visitor decides; share sends the event link and the stop time, never a session or plan id. The phone's Back
  button closes the sheet.
- On a phone up to 860 px tall the welcome screen is compact (smaller logo, no second mascot), so the message box,
  the send button and the examples are above the fold.
- Live walking guidance no longer closes on a single GPS error (audit 3.3): a timeout or lost signal keeps the
  guide on the last good position with one notice; only a revoked location permission ends it.
- Browser test `tests/ui/mobile-app.spec.mjs`: no questionnaire, the send button above the fold at 360 × 740, the
  stop menu and Back, and no sideways scrolling on any tab.
- App shell. On phones the first screen is a chat: Wanees greets in a bubble and the message box is docked at
  the bottom like a messaging app, with the start point and the examples in one sideways-scrolling row above it.
  On phones and tablets the top bar stays put (sticky, blurred) over a soft app background, controls get a small
  press-down and no tap flash, and switching tabs cross-fades with View Transitions (Chrome, Safari 18) while the
  top bar and the tab bar stay still; reduced motion turns it off.
  Prices (`--gold`) are a shade darker in the visitor app (`#8c5714`) so they keep 4.5:1 on the new background.
  The responsive test treats a control inside a sideways-scrolling strip as reachable, not clipped.
- The visitor app turns off the Next.js development badge (`devIndicators: false`): on a phone it covered the
  bottom navigation's «أنا» tab. Build and runtime errors still open the development overlay.

### Accessibility sweep and contrast

- `tests/ui/accessibility.spec.mjs` checks WCAG 2.2 basics without a new dependency, on the visitor home, both
  events, a built plan, the live board, the kiosk page, organizer sign-in, the dashboard and the event workspace,
  in Chromium, Firefox and WebKit. It checks the Arabic RTL document, landmarks, an accessible name on every
  control, labelled fields, alt text, unique ids, 24 × 24 px buttons and text contrast (4.5:1, 3:1 large). A
  self-check plants one fault of each kind and requires the sweep to report it. Text over gradients or images is
  skipped and still needs a visual check.
- Contrast fixes it found. Muted labels (`--ink-3`, `--dim`) went from `#857c9e` (3.9:1 on white) to `#6a6286`
  (5.7:1), the value the visitor flow already used. Prices (`--gold`) are now `#9c6118`, success green (`--ok`)
  `#137a4f`, and the brand teal for text (`--teal`) `#007766`, so the organizer's badges reach 4.5:1 on their
  tinted backgrounds.

### Kiosk screens in the organizer app

- The event page has a «شاشات الاستعلام» panel (`admin/app/events/[eventSlug]/kiosk-screens.tsx`). Owners and
  admins add a screen by name at an open walkway node of the published catalog and get its link once, with a QR
  code to scan from the screen; the token stays in the link's fragment and only its hash is stored. Revoking asks
  first, ends the screen's open visit, and folds the screen under «الموقوفة». Operators see the list. It uses the
  existing kiosk API; there is no schema change.
- Browser test: an organizer adds a kiosk on a phone, opens it from the link on another device, and revokes it.
- A database error while loading a published catalog is now logged in production (`wanees.catalog`
  `catalog_load_failed`) instead of silently becoming «الفعالية غير متاحة». CI prints the servers' logs when the HTTP
  integration job fails.

### Engineering audit — phase 6 (proof)

- Nightly agent eval with the real model (`.github/workflows/agent-eval-nightly.yml`,
  `scripts/nightly-agent-eval.mjs`): 3 runs on Boulevard World and the sample festival, failing on any guardrail
  or grounding failure or a pass rate under 95%. It needs the `OPENAI_API_KEY` repository secret and builds
  the apps on the runner (or evaluates `vars.WANEES_EVAL_BASE_URL`, a staging server). New personas: no survey,
  a plane-loving child, categories, a located visitor, a returning visitor, a kiosk, Saudi slang, French and
  Urdu (French and Urdu run only with `--model`). `agent-eval` gains `--model`, `--min-pass`, a GitHub step
  summary, and waits out the session rate limit instead of failing.
- Per-visitor AI fallback (`app/lib/circuit-breaker.ts`): one visitor's timeouts no longer switch the model
  off for everyone. Each visit has a breaker (5 failures in 60 s open it for 30 s, then one trial), plus a
  shared breaker at 25 failures for a provider outage. Classification timeouts are 3 s.
- Request hardening: state-changing API requests from another site's page get 403 `ORIGIN_FORBIDDEN`
  (native apps, kiosks and webhooks send no Origin; `WANEES_ALLOWED_ORIGINS` trusts more), and pages in both
  apps carry a per-response nonce `script-src` with `'strict-dynamic'` (`packages/contracts/src/web-security.ts`).
  Every page now renders per request.
- The second event end to end: `sample-festival` is a whole event (`app/data/sample_festival.json`) with its own
  GPS calibration, gates, services, walkways, 16 described and tagged activities and schedules, seeded through the
  same helpers as Boulevard World. `npm run test:any-event` runs the visitor flow on any event from its catalog
  alone; CI runs it, the agent contract and the agent eval on the sample festival too.
- «وش أول شي نسويه؟» now asks for the next stop instead of falling to «وضح لي».
- Unticking «تذكّرني» in «أنا» could flip back on a slow connection, when the tab's own reading of the visit
  arrived after the change. Readings that started before a change, or while it is saving, are now ignored.

### Engineering audit — phase 5 (any screen)

- One agent contract for every screen (`packages/contracts/src/agent.ts`): the request (message or action, reply
  mode, position, language, link grant) and the response (text, A2UI, sources, proposal, directions). The
  assistant takes `language` (a language picked on the screen) and `linkGrantId`.
- Kiosk screens (`KioskDevice`, migration `20261128090000_kiosk_devices`): organizers register a screen at a walkway
  node and get its token once (`/api/v1/events/{slug}/kiosks` in the organizer app, with revoke). A kiosk visit
  is anonymous, has no memory, ends after 60 seconds idle, and counts every walking answer from the kiosk.
  With a phone's link code it reads that plan and refuses to change it.
- A plain kiosk test page at `/kiosk/{slug}` (large targets, Arabic and English, link code, «انتهيت»).
- `npm run test:agent-contract`: one scripted conversation through the phone, a live call and a kiosk at the same
  node returns the same facts; plus the kiosk's origin, no memory, read-only link and revoke. Unit tests in
  `app/lib/kiosk-test.mjs` and a browser test in `tests/ui/kiosk.spec.mjs`.

### Engineering audit — phase 4 (remember me, without a name)

- «تذكّرني للزيارة الجاية (بدون اسم أو جوال)» in «أنا», unticked by default, and asked once in the chat after
  the first plan (`PATCH /session { rememberMe }`). Unticking it deletes the anonymous profile and its cookie.
- A returning guest sees «هلا فيك من جديد! نفس جوّ المرة الماضية؟» and starts the same mood in one tap. The visit is
  counted (`GuestProfile.visitCount`, `lastVisitAt`), the new plan skips earlier visits' activities
  (`VisitorSession.previouslyVisited`) and the agent brief says «زائر عائد». A registered visitor gets the same.
- «اعرض مسارك على شاشة»: the phone shows a 6-character code and a QR (10 minutes, one use). A screen that enters it
  reads the plan only, until a minute without use, «انتهيت», or «أوقف الربط» on the phone
  (`/api/v1/events/{slug}/link`, `/link/redeem`, `/link/{grantId}`; `VisitorLinkGrant`).
- Registering merges a remembered guest into the visitor in one transaction (history, and taste when the visitor
  had none); the guest profile and cookie go.
- Migration `20261127130000_guest_memory_link_codes` (additive, with CHECK constraints and a rollback note).
- Tests: returning guest and link codes in `test:http` (single use, read-only scope, revoke, «انتهيت», another
  event), the merge in `test:visitors`, `app/lib/visitor-link-test.mjs`, and «تذكّرني» end to end in
  `tests/ui/app-shell.spec.mjs`.

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
