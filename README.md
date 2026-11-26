<p align="center">
  <img src="app/public/brand/logo.webp" height="120" alt="ونيس WANEES">
</p>

<h3 align="center">الونيس اللي بيونسك</h3>

<p align="center">
  WANEES turns an event's catalog into an Arabic-first personal guide: a calculated plan for every visitor, adjusted with their consent when the venue changes.
</p>

<p align="center">
  <a href="https://github.com/abc7pq/wanees_platform/actions/workflows/ci.yml"><img src="https://github.com/abc7pq/wanees_platform/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/Node.js-26-8e2bff" alt="Node.js 26">
  <img src="https://img.shields.io/badge/Next.js-15-4a05a6" alt="Next.js 15">
  <img src="https://img.shields.io/badge/PostgreSQL-16-0066ff" alt="PostgreSQL 16">
  <img src="https://img.shields.io/badge/UI-Arabic%20RTL-ff1e8d" alt="Arabic RTL">
</p>

<div dir="rtl">

## ونيس · WANEES

**ونيس يحوّل كتالوج فعاليتك إلى مرشد شخصي بالعربي: جولة محسوبة لكل زائر على وقته وميزانيته ومن معه، تتعدّل بموافقته لما يتغيّر شيء في الموقع.**

أول فعالية مهيأة عليه: **بوليفارد وورلد، موسم الرياض 2026-27**.

**جرّبه الآن:** الزائر [wanees.win](https://wanees.win) ([الجولة مباشرة](https://wanees.win/demo)) · المنظّم [admin.wanees.win](https://admin.wanees.win)

- **محسوب، مو مولَّد.** المحطات والأسعار والأوقات والمشي يحسبها محرك حتمي (`buildRoute` في `app/engine/route.ts`) من الكتالوج المنشور. النموذج اللغوي يفهم ويشرح فقط، وحارس `groundingViolations` (`app/lib/agent-persona.ts`) يرفض أي رد نصي من النموذج فيه رقم أو سعر أو وقت مو موجود في بيانات المحرك، ويرجع للرد الحتمي بدله. وبدون مفتاح ذكاء اصطناعي يشتغل كل شيء بردود حتمية من نفس البيانات.
- **التغيير حي، والقرار للزائر.** المنظّم ينشر تأخيرًا أو زحامًا، فيجهّز ونيس لكل زائر متأثر اقتراحًا صالحًا 15 دقيقة، ويُعتمد داخل معاملة قاعدة بيانات تتحقق من المسار ونسخة الحالة الحية. الاستثناء الوحيد: نشاط أُغلق يُشال من المسار مباشرة لأنه ما عاد متاحًا.
- **مبني للمنظّمين.** كتالوج بإصدارات، لوحة تشغيل حية، حوافز توزّع الحركة، و«مسرح الحركة» لتجربة التأخير قبل نشره (التفاصيل تحت).
- **خصوصي افتراضيًا.** الزائر مجهول بجلسة كوكي `HttpOnly`، ورسائل المساعد تُحفظ منقّحة وتنتهي بعد 24 ساعة، وفيه مسار لحذف بيانات الجلسة. التسجيل بالاسم ورقم جوال موثّق برسالة SMS **اختياري** يفعّله المنظّم (`WANEES_FEATURE_VISITOR_REGISTRATION`، مطفأ افتراضيًا)، بموافقة نصها له إصدار، ويُحذف الزائر المسجّل بعد 365 يومًا بلا زيارة عبر `npm run db:cleanup`.

</div>

<p align="center">
  <img src="docs/screenshots/01-home.png" width="160" alt="الصفحة الرئيسية">
  <img src="docs/screenshots/02-talk.png" width="160" alt="قل لي وش بالك: محادثة بدل الاستبيان">
  <img src="docs/screenshots/03-plan-next-step.png" width="160" alt="مسارك مع شريط التنقل السفلي">
  <img src="docs/screenshots/08-stop-menu.png" width="160" alt="قائمة المحطة المنبثقة: اتجاهات، خريطة، ليش، بدّل، شيل، شارك">
  <img src="docs/screenshots/04-change-proposal.png" width="160" alt="اقتراح تعديل المسار">
  <img src="docs/screenshots/05-assistant.png" width="160" alt="مساعد ونيس">
</p>

<div dir="rtl">

## وش يسوي ونيس للزائر؟

| | الميزة | كيف تشتغل في الكود |
|---|---|---|
| 💬 | **كم سؤال ومسار** | مين معك وكم عددكم وعمر أصغر طفل، المزاج، الميزانية، الاهتمامات، الوقت ← محرك حتمي يرتّب المحطات ضمن الوقت والميزانية والأعمار ومواعيد العروض ووقت المشي |
| 🧭 | **«خطوتك الجاية» مع السبب** | بطاقة المحطة القادمة، وشرح «ليش هذا المسار؟» مبني على بيانات الكتالوج |
| 🔔 | **يتعامل مع التغيير** | المشغّل ينشر تأخيرًا أو إغلاقًا بسبب ظاهر للزائر ← ونيس يجهّز اقتراحًا بالفرق (المحطات، السعر قبل/بعد، نهاية الجولة) |
| ✋ | **ما يغيّر مسارك إلا بموافقتك** | الاقتراح صالح 15 دقيقة، والاعتماد يتحقق من المسار الحالي ونسخة الحالة الحية داخل معاملة قاعدة بيانات. الاستثناء الوحيد: نشاط أُغلق يُشال لأنه ما عاد متاح |
| 🎁 | **حوافز توزّع الحركة** | المشغّل ينشر حافزًا («قهوتك علينا») بمكان وصلاحية، يظهر في بطاقة الاقتراح، والزائر يطلبه مرة وحدة، واللوحة تقيس الاستخدام |
| 🗣️ | **مساعد عربي سعودي، نص وصوت** | النموذج اللغوي (OpenAI) يفهم الطلب ويسولف، وأدوات مبنية على الكتالوج تنفّذ. المكالمة الصوتية عبر OpenAI Realtime متاحة لما يكون المفتاح مضبوطًا. بدون مفتاح أو اتصال: ردود حتمية من نفس البيانات |
| 🔔 | **تنبيهات على شاشة القفل** | Web Push اختياري يذكّر الزائر بمحطته الجاية (يحتاج مفاتيح VAPID) |
| 🌤️ | **الطقس الحي** | قراءة Open-Meteo للموقع كل 10 دقائق، في واجهة الزائر واللوحة الحية وردود المساعد. إذا تعذّر الاتصال يظهر «تقدير» ولا يُدّعى أنه حي |

## للمنظّمين

| | ماذا تحصل | أين في الكود |
|---|---|---|
| 📣 | **انشر تأخيرًا أو إغلاقًا، وكل مسار متأثر يستجيب** | تحديث البرنامج بسبب ظاهر للزائر وسجل تدقيق؛ الإغلاق يُطبّق فورًا، والتأخير والزحام يصل الزائر كاقتراح ينتظر موافقته |
| 📊 | **إشغال المناطق ووقت الانتظار** | لوحة المشغّل `/ops`: إشغال، انتظار، توقعات المسارات حسب المنطقة، طلبات مساعدة الزوار، ومؤشرات آخر 24 ساعة بلا معرّفات جلسات |
| 🗂️ | **كتالوج بإصدارات** | مسودة ← مراجعة المصادر والتحقق ← نشر ← تراجع، والزائر يبقى على نسخة الكتالوج اللي بدأ فيها لو أُعيد النشر |
| 🎁 | **حوافز لها صلاحية** | حافز بمكان ووقت انتهاء، يُطلب مرة وحدة، ويُقاس استخدامه |
| 🎭 | **«مسرح الحركة» قبل النشر** | `/ops/theater`: نفس الزوار ونفس الليلة مع ونيس وبدونه، لتجربة أثر تأخير قبل نشره (محاكاة) |
| 🏢 | **أكثر من فعالية** | كل استعلام للمنظّم محصور بمنظمته وفعاليته؛ البذرة تنشئ بوليفارد وورلد وفعالية ثانية صغيرة لإثبات العزل |
| 🔒 | **خصوصية افتراضية** | زوار مجهولون، بيانات بأقل قدر، تنظيف دوري، والتسجيل بالاسم والجوال لا يعمل إلا إذا فعّلته |

## الحقيقي والمحاكى

| حقيقي | محاكى أو مفترض |
|---|---|
| 111 سجلًا جمعها الفريق ومصحّحة على دليل موسم 2026-27 الرسمي | مواعيد العروض والإقبال المتوقع: افتراضات تخطيط (الموقع ما ينشر جدولًا)، ومعلَّمة كذا في الواجهة |
| 23 منطقة بمواقع مرسومة من صور الأقمار الصناعية وخريطة الموقع الرسمية | عدّادات البوابات والمداخل: تحتاج أجهزة في الموقع، وتظهر كمصدر «محاكاة» واضح |
| | أسعار الأنشطة: تقدير الفريق، وتظهر للزائر كأسعار تقريبية |
| الطقس الحي (Open-Meteo)، تحديثات المشغّل، حضور أجهزة الزوار اللي وافقوا على مشاركة موقعهم | أرقام الأثر (الانتظار، توزيع الزحام): من محاكاة حتمية، **ليست** قياسًا ميدانيًا |
| المساعد النصي والصوتي عند ضبط مفتاح OpenAI | |

## وعود العرض مقابل الكود

`npm run claims:audit` (يشتغل في CI) يتحقق آليًا من أرضيتين فقط مقابل البيانات المشحونة: عدد سجلات الفريق ≥ 110، والمناطق بمواقع ≥ 23، ويتأكد من وجود `docs/SIMULATION.md`. ويفشل CI إذا نزل أي رقم منها تحت الأرضية. باقي الأسطر أدناه موثّقة بمسارات في الكود، لا بفحص آلي.

| وعد العرض | الحالة | الدليل |
|---|---|---|
| 110 فعاليات ومطاعم وعروض جمعها الفريق | ✅ **111** سجلًا | `data/sources/boulevard_world_2026_corrected.csv` (مصحّح على دليل الموسم 2026-27 الرسمي). منها **90** منشورة و**21** في المناطق السبع الجديدة لـ2026 تنتظر موقعها على الخريطة بدل إحداثيات مخترعة. (`app/data/boulevard_world_2026.json`) |
| 23 منطقة بمواقع محددة | ✅ **23** | `data/sources/boulevard_world_2026_zone_positions.json` |
| مصادر البيانات: التطبيق، العروض، الطقس | ✅ | قراءات المشغّل وحضور أجهزة الزوار (بموافقتهم) والطقس الحي فعلية. البوابات والعدّادات تحتاج أجهزة الموقع، وتظهر كمصدر «محاكاة» واضح |
| محرك المسارات والوكيل الحواري ولوحتا الزائر والمشغّل مع اختبارات ناجحة | ✅ | CI أدناه: وحدات، عقد API، قاعدة بيانات، HTTP، قصة العرض كاملة، اختبارات متصفح على ثلاثة محركات (Chromium وFirefox وWebKit)، اختبار حمل |
| مقارنة التوصية بتوجيه الزائر للأقل ازدحامًا | ✅ محاكاة حتمية | «مسرح الحركة» `/ops/theater` على كتالوج بوليفارد (600 زائر، تأخير 25 دقيقة لعرض الدولفيناريوم، استخدام 40٪): متوسط وقوف جمهور العرض **30.6 ← 21.2 دقيقة**. ومقارنة منطق المنسّق في سيناريو اصطناعي من خمس مناطق (`node scripts/simulate.mjs`، ليس كتالوج بوليفارد): نفس توازن الحمل، واكتشاف الأنشطة الأقل شهرة 63.6٪ مقابل 51.4٪. التفاصيل: [`docs/SIMULATION.md`](docs/SIMULATION.md) |
| قياس الأثر ميدانيًا | ⏭️ الخطوة الجاية | تجربة في منطقة وحدة. دليل التشغيل جاهز: [`docs/VENUE_PILOT_RUNBOOK.md`](docs/VENUE_PILOT_RUNBOOK.md) |

## الهوية البصرية

الشعار والألوان والخطوط والتميمة مطبّقة في التطبيقين حسب «دليل الهوية البصرية — ونيس»: بنفسجي `#8E2BFF` أساسي مع تيل وأزرق ووردي وبرتقالي وأصفر، خط IBM Plex Sans Arabic للعربي و Inter للإنجليزي، وتميمة ونيس ترافق الزائر. التفاصيل وأين يظهر كل عنصر: [`docs/BRAND_IDENTITY.md`](docs/BRAND_IDENTITY.md).

## نشأة المشروع

بدأ ونيس حلًّا لتحدي «خدمة المرشد الشخصي الذكي التفاعلي» في هاكاثون agentX الرابع، بشراكة الهيئة العامة للترفيه، ويُطوَّر الآن منتجًا متعدد الفعاليات.

</div>

<p align="center">
  <img src="docs/screenshots/06-ops-dashboard.png" width="410" alt="لوحة المشغّل">
  <img src="docs/screenshots/07-organizer.png" width="410" alt="لوحة إدارة المنظّم">
</p>

## Architecture

```mermaid
flowchart LR
  V[Visitor app<br/>Next.js · Arabic RTL] -->|cookie session| API
  O[Organizer app<br/>Next.js · scrypt logins] -->|event-scoped API| API
  subgraph API[Visitor & organizer APIs]
    E[Deterministic planner<br/>time · budget · ages · shows · walking]
    C[Season coordinator<br/>capacity · demand · incentives]
    A[Assistant<br/>intent + catalog tools + grounding guard]
  end
  A -->|intent + conversation| L[(OpenAI Responses<br/>gpt-6-luna)]
  V -.->|voice over WebRTC<br/>2-minute ephemeral key| R[(OpenAI Realtime)]
  R -.->|ask_wanees_engine tool| A
  API -->|due nudges| P[(Web Push<br/>browser push services)]
  API -->|current weather| W[(Open-Meteo)]
  API -.->|optional registration| S[(Twilio Verify<br/>SMS code)]
  API --> DB[(PostgreSQL · Prisma<br/>catalog versions · sessions · updates · audit)]
```

Dashed lines are optional: voice needs `OPENAI_API_KEY`, and SMS verification runs only when an organizer enables `WANEES_FEATURE_VISITOR_REGISTRATION` and configures `WANEES_SMS_PROVIDER=twilio`. Web Push needs VAPID keys (`npm run push:keys`).

The computer calculates, the agent explains, the visitor decides. The language model classifies requests and talks with the visitor, but it never picks stops, prices or times; those come from the deterministic planner (`app/engine/route.ts`), the shared domain services in `packages/engine/` (coordinator, simulation, walkway graph, event clock) and the published catalog. Registered visitor names and phone numbers are never sent to the model.

## Run it locally

Requirements: **Node.js 26** (`.nvmrc` pins 26.12.1; both apps require ≥ 26) and **PostgreSQL 16+** (a local install, or `docker compose up -d postgres`).

```bash
git clone https://github.com/abc7pq/wanees_platform.git
cd wanees_platform

# 1. Install, write local env files, create + migrate + seed the database
DATABASE_URL="postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public" \
OPENAI_API_KEY="sk-..." \
npm run setup            # the OpenAI key is optional: planning works without it

# 2. Build and start both apps (add -- --force to rebuild after changes)
npm run start:local

# 3. In a second terminal: verify everything against the running apps
npm run verify:local
```

On Windows PowerShell set the variables first: `$env:DATABASE_URL="..."; $env:OPENAI_API_KEY="..."; npm run setup`.

| Open | URL |
|---|---|
| Landing page | http://localhost:3100 |
| Visitor app | http://localhost:3100/demo |
| Operator view | http://localhost:3100/ops |
| Organizer app | http://localhost:3200 — `owner@wanees.demo`, password printed by `npm run setup` |

For a quick local demo login, `npm run db:demo-admin` creates a demo organizer and shows its email and password in a panel on the login page; that local panel only appears on `localhost`. A deployment can also show a demo login on the public login page by setting `WANEES_PUBLIC_DEMO_EMAIL` and `WANEES_PUBLIC_DEMO_PASSWORD`; that panel is shown only for an active account whose memberships are all read-only `VIEWER` (see [OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md)).

## Verify everything

| Check | Command |
|---|---|
| Visitor and organizer unit, contract and accessibility suites | `npm test --prefix app` · `npm test --prefix admin` |
| Architecture boundaries · OpenAPI contract | `npm run test:architecture` · `npm run test:contract` |
| Schema, seed, retention, encrypted backup and restore rehearsal | `npm run db:smoke` · `npm run test:retention` · `npm run db:backup && npm run db:restore-smoke` |
| Full HTTP flow (session, plan, assistant, live update, replan, revoke) | `npm run test:http` |
| The presentation story end to end (family, 300 SAR, 25-minute delay, approval) | `npm run test:deck-story` |
| Deck number floors against the shipped data · catalog built from its sources | `npm run claims:audit` · `npm run catalog:build -- --check` |
| Responsive browser suite (Chromium, Firefox, WebKit) | `npm run test:ui` (needs a throwaway database in `WANEES_UI_DATABASE_URL`) |
| Accessibility sweep (names, labels, alt, ids, 24 px targets, text contrast) on the main screens | `npm run test:ui -- tests/ui/accessibility.spec.mjs` |
| 120-request concurrency smoke | `node scripts/load-test.mjs http://127.0.0.1:3100 120 12 1500` |
| Optional visitor registration flow | `npm run test:visitors` |
| README screenshots | `node --env-file=admin/.env.local scripts/capture-screens.mjs` |

CI (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`, against PostgreSQL 16. It runs every check in this table except the visitor registration smoke and the screenshot capture, plus `npm audit`, both production builds, a committed-key scan, the idempotency, proposal-guard, late-evening, isolated-rehearsal and second-venue publication smokes.

## Security

- **Secrets stay server-side.** The OpenAI key lives only in the visitor server's ignored `.env.local`; no secret is committed or sent to the browser. The voice call gets a two-minute ephemeral key.
- **Sessions.** Visitors are anonymous by default with a random token stored hashed and an `HttpOnly; SameSite=Lax` cookie (`Secure` in production). Organizer passwords are hashed with scrypt.
- **Optional registration.** Off by default. When an organizer enables it, the visitor gives a name and a phone number verified by SMS (Twilio Verify), under a versioned consent; WANEES never stores the SMS code, and inactive registered visitors are deleted after `WANEES_RETENTION_VISITOR_DAYS` (default 365).
- **Isolation and integrity.** Every organizer query is scoped to its organization and event; updates are idempotent and revocations are kept in an audit log.
- **Abuse limits.** Assistant and session endpoints are rate-limited with salted identifiers.
- **LLM safety.** Event context and visitor text are passed as untrusted data and the model cannot change an itinerary. In text chat, emails and simple-format Saudi mobile numbers are redacted before the model; voice audio goes to OpenAI Realtime as spoken, without redaction, and is never stored by WANEES servers. See [llm-data-flow.md](docs/privacy/llm-data-flow.md).
- **Legacy operator token.** `ADMIN_TOKEN` is a break-glass header for scripts; leave it unset in production and use organizer logins.
- **Hardening.** Health checks expose no internals; both apps send `frame-ancestors 'none'`, `nosniff`, a strict referrer policy and a minimal `Permissions-Policy`; backups are encrypted with AES-256-GCM.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Repository map

| Path | What it is |
|---|---|
| `app/` | Visitor web app and visitor API (Next.js); the deterministic planner is `app/engine/route.ts` |
| `admin/` | Organizer app and organizer API (Next.js) |
| `packages/engine/` | Shared domain services: season coordinator, crowd sources, simulation and crowd theater, walkway graph, event clock, incentives |
| `packages/contracts/` | Shared API contracts, error codes and feature flags |
| `prisma/` | Schema, migrations, seed |
| `scripts/` | Local workflow, smoke tests, backup, retention, import, simulation, screenshots |
| `data/sources/` | The season data: team records, zone positions, sourced prices (`npm run catalog:build` turns them into the published catalog) |
| `docs/` | Architecture decisions, API contract, runbooks, evaluation, simulation, brand identity ([index](docs/README.md)) |
| `deploy/` | Production setup ([Hetzner](deploy/hetzner/README.md)) |

## Documentation

Start at the [documentation index](docs/README.md).

| Topic | Document |
|---|---|
| Product direction and build plan | [MASTER_BUILD_PLAN.md](docs/MASTER_BUILD_PLAN.md) · [PRODUCT_PLATFORM_PLAN.md](docs/PRODUCT_PLATFORM_PLAN.md) |
| Working on the code (people and AI agents) | [CONTRIBUTING.md](CONTRIBUTING.md) · [AGENTS.md](AGENTS.md) · [AI_AGENT_CONTEXT.md](docs/AI_AGENT_CONTEXT.md) |
| What changed | [CHANGELOG.md](CHANGELOG.md) |
| Database schema · architecture decisions | [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) · [docs/decisions](docs/decisions) |
| API contract | [docs/api](docs/api) |
| Running it · operations · venue pilot · deployment | [RUNBOOK_LOCAL.md](docs/RUNBOOK_LOCAL.md) · [OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md) · [VENUE_PILOT_RUNBOOK.md](docs/VENUE_PILOT_RUNBOOK.md) · [deploy/hetzner](deploy/hetzner/README.md) |
| Privacy and retention | [RETENTION.md](docs/RETENTION.md) · [llm-data-flow.md](docs/privacy/llm-data-flow.md) |
| Evaluation and simulation | [AI_EVAL.md](docs/AI_EVAL.md) · [SIMULATION.md](docs/SIMULATION.md) · [docs/eval](docs/eval) |
| Brand identity | [BRAND_IDENTITY.md](docs/BRAND_IDENTITY.md) |

License: all rights reserved (no license granted yet).

<div dir="rtl">

## فريق ونيس

| الاسم | الدور |
|---|---|
| منصور العنزي | قائد الفريق · تطوير حلول الذكاء الاصطناعي |
| صالح العنزي | تطوير الواجهة الأمامية · علم البيانات |
| عبدالرحمن العنزي | تطوير الواجهة الخلفية · الأمن السيبراني |
| رياض العنزي | البحث وضمان الجودة · الأمن السيبراني |

</div>
