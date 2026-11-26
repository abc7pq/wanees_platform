<p align="center">
  <img src="app/public/brand/logo.webp" height="120" alt="ونيس WANEES">
</p>

<h3 align="center">الونيس اللي بيونسك</h3>

<p align="center">
  The personal AI guide for festival and event visitors · Arabic-first · built for Riyadh Season's Boulevard World
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

**المرشد الذكي اللي يونسك — من حوسة وضياع إلى تجربة أونس.**

مرشد شخصي ذكي وتفاعلي لزوار الفعاليات والمهرجانات. يسألك كم سؤال، يرتّب لك مسار زيارة يناسب وقتك وميزانيتك ومن معك، ولو تغيّر شيء في الموقع يقترح لك بديل… والقرار الأخير لك.
بُني لتحدي **«خدمة المرشد الشخصي الذكي التفاعلي»** في هاكاثون **agentX الرياض — مسار الترفيه والألعاب**، وأول فعالية مهيأة عليه هي **بوليفارد وورلد**.

</div>

<p align="center">
  <img src="docs/screenshots/01-home.png" width="190" alt="الصفحة الرئيسية">
  <img src="docs/screenshots/03-plan-next-step.png" width="190" alt="خطوتك الجاية">
  <img src="docs/screenshots/04-change-proposal.png" width="190" alt="اقتراح تعديل المسار">
  <img src="docs/screenshots/05-assistant.png" width="190" alt="مساعد ونيس">
</p>

<div dir="rtl">

## وش يسوي ونيس؟

| | الميزة | كيف تشتغل في الكود |
|---|---|---|
| 💬 | **كم سؤال ومسار** | مين معك وكم عددكم وعمر أصغر طفل، المزاج، الميزانية، الاهتمامات، الوقت ← محرك حتمي يرتّب المحطات ضمن الوقت والميزانية والأعمار ومواعيد العروض ووقت المشي |
| 🧭 | **«خطوتك الجاية» مع السبب** | بطاقة المحطة القادمة، وشرح «ليش هذا المسار؟» مبني على بيانات الكتالوج |
| 🔔 | **يتعامل مع التغيير** | المشغّل ينشر تأخيرًا أو إغلاقًا بسبب ظاهر للزائر ← ونيس يجهّز اقتراحًا بالفرق (المحطات، السعر قبل/بعد، نهاية الجولة) |
| ✋ | **ما يغيّر مسارك إلا بموافقتك** | الاقتراح صالح ١٥ دقيقة، والاعتماد يتحقق من المسار الحالي ونسخة الحالة الحية داخل معاملة قاعدة بيانات. الاستثناء الوحيد: نشاط أُغلق يُشال لأنه ما عاد متاح |
| 🎁 | **حوافز توزّع الحركة** | المشغّل ينشر حافزًا («قهوتك علينا») بمكان وصلاحية، يظهر في بطاقة الاقتراح، والزائر يطلبه مرة وحدة، واللوحة تقيس الاستخدام |
| 🗣️ | **مساعد عربي سعودي، نص وصوت** | النموذج اللغوي (OpenAI) يفهم الطلب ويسولف، وأدوات مبنية على الكتالوج تنفّذ. بدون مفتاح أو اتصال: ردود حتمية من نفس البيانات |
| 🌤️ | **الطقس الحي** | قراءة Open-Meteo للموقع كل ١٠ دقائق، في واجهة الزائر واللوحة الحية وردود المساعد. إذا تعذّر الاتصال يظهر «تقدير» ولا يُدّعى أنه حي |
| 📊 | **لوحة المشغّل** | إشغال المناطق ووقت الانتظار، توقعات المسارات حسب المنطقة، تحديثات البرنامج مع سجل تدقيق، طلبات مساعدة الزوار، مؤشرات آخر ٢٤ ساعة، و«مسرح الحركة» لتجربة تأخير قبل نشره |
| 🗂️ | **أكثر من فعالية** | كتالوج بإصدارات (مسودة ← مراجعة ← نشر ← تراجع)، والزائر يبقى على نسخة الكتالوج اللي بدأ فيها لو أُعيد النشر |

## وعود العرض مقابل الكود

كل رقم في العرض التقديمي يُفحص آليًا في CI بـ `npm run claims:audit`، ويفشل البناء إذا صار غير صحيح.

| وعد العرض | الحالة | الدليل |
|---|---|---|
| ١١٠ فعاليات ومطاعم وعروض جمعها الفريق | ✅ **١١١** سجلًا | `data/sources/boulevard_world_2026_corrected.csv` (مصحّح على دليل الموسم 2026-27 الرسمي). **٩٢** منها منشورة للزوار، و٢١ في المناطق السبع الجديدة لـ2026 تنتظر موقعها على الخريطة بدل إحداثيات مخترعة |
| ٢٣ منطقة بمواقع محددة | ✅ **٢٣** | مواقع مرسومة من صور الأقمار الصناعية وخريطة الموقع الرسمية: `data/sources/boulevard_world_2026_zone_positions.json` |
| ١٧ سعرًا موثقًا | ✅ **١٧** | من [webook.com](https://webook.com/blog/boulevard-world-riyadh-season-guide/)، البائع الرسمي (١٧ نوفمبر 2026). تظهر للزائر بعلامة ✓، وباقي الأسعار مكتوب عليها «تقديري» |
| مصادر البيانات: التطبيق، العروض، الطقس | ✅ | قراءات المشغّل وحضور أجهزة الزوار (بموافقتهم) والطقس الحي فعلية. البوابات والعدّادات تحتاج أجهزة الموقع، وتظهر كمصدر «محاكاة» واضح |
| محرك المسارات والوكيل الحواري ولوحتا الزائر والمشغّل مع اختبارات ناجحة | ✅ | CI أدناه: وحدات، عقد API، قاعدة بيانات، HTTP، قصة العرض كاملة، اختبارات متصفح على ثلاثة محركات (Chromium وFirefox وWebKit)، اختبار حمل |
| مقارنة التوصية بتوجيه الزائر للأقل ازدحامًا | ✅ محاكاة حتمية | `node scripts/simulate.mjs` و«مسرح الحركة» `/ops/theater`: نفس توازن الحمل (١٠٠٪)، واكتشاف الأنشطة الأقل شهرة ٦٣٫٦٪ مقابل ٥١٫٤٪ |
| قياس الأثر ميدانيًا | ⏭️ الخطوة الجاية | كما في العرض: تجربة في منطقة وحدة. دليل التشغيل جاهز: [`docs/VENUE_PILOT_RUNBOOK.md`](docs/VENUE_PILOT_RUNBOOK.md) |

مواعيد العروض والإقبال المتوقع افتراضات تخطيط (الموقع ما ينشر جدولًا)، ومعلَّمة كذا في الواجهة.

## الهوية البصرية

الشعار والألوان والخطوط والتميمة مطبّقة في التطبيقين حسب «دليل الهوية البصرية — ونيس»: بنفسجي `#8E2BFF` أساسي مع تيل وأزرق ووردي وبرتقالي وأصفر، خط IBM Plex Sans Arabic للعربي و Inter للإنجليزي، وتميمة ونيس ترافق الزائر. التفاصيل وأين يظهر كل عنصر: [`docs/BRAND_IDENTITY.md`](docs/BRAND_IDENTITY.md).

</div>

<p align="center">
  <img src="docs/screenshots/06-ops-dashboard.png" width="410" alt="لوحة المشغّل">
  <img src="docs/screenshots/07-organizer.png" width="410" alt="لوحة إدارة المنظّم">
</p>

## Architecture

```mermaid
flowchart LR
  V[Visitor app<br/>Next.js · Arabic RTL · voice] -->|cookie session| API
  O[Organizer app<br/>Next.js · scrypt logins] -->|event-scoped API| API
  subgraph API[Visitor & organizer APIs]
    E[Deterministic planner<br/>time · budget · ages · shows · walking]
    C[Season coordinator<br/>capacity · demand · incentives]
    A[Assistant<br/>intent + catalog tools]
  end
  A -->|intent + conversation| L[(OpenAI Responses<br/>gpt-6-luna)]
  API --> DB[(PostgreSQL · Prisma<br/>catalog versions · sessions · updates · audit)]
```

The computer calculates, the agent explains, the visitor decides. The language model classifies requests and talks with the visitor, but it never picks stops, prices or times; those come from the deterministic engine (`packages/engine`) and the published catalog.

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

For a quick local demo login, `npm run db:demo-admin` creates a demo organizer and shows its email and password in a panel on the login page. The panel only appears on `localhost`.

## Verify everything

| Check | Command |
|---|---|
| Visitor and organizer unit, contract and accessibility suites | `npm test --prefix app` · `npm test --prefix admin` |
| Architecture boundaries · OpenAPI contract | `npm run test:architecture` · `npm run test:contract` |
| Schema, seed, retention, encrypted backup and restore rehearsal | `npm run db:smoke` · `npm run test:retention` · `npm run db:backup && npm run db:restore-smoke` |
| Full HTTP flow (session, plan, assistant, live update, replan, revoke) | `npm run test:http` |
| The presentation story end to end (family, 300 SAR, 25-minute delay, approval) | `npm run test:deck-story` |
| Every pitch-deck number against the shipped data · catalog built from its sources | `npm run claims:audit` · `npm run catalog:build -- --check` |
| Responsive browser suite (Chromium, Firefox, WebKit) | `npm run test:ui` (needs a throwaway database in `WANEES_UI_DATABASE_URL`) |
| 120-request concurrency smoke | `node scripts/load-test.mjs http://127.0.0.1:3100 120 12 1500` |
| README screenshots | `node --env-file=admin/.env.local scripts/capture-screens.mjs` |

CI runs all of the above on every push to `main` and every pull request, against a real PostgreSQL 16.

## Security

- **Secrets stay server-side.** The OpenAI key lives only in the visitor server's ignored `.env.local`; no secret is committed or sent to the browser.
- **Sessions.** Visitors are anonymous by default with a random token stored hashed and an `HttpOnly; SameSite=Lax` cookie (`Secure` in production). Organizer passwords are hashed with scrypt.
- **Isolation and integrity.** Every organizer query is scoped to its organization and event; updates are idempotent and revocations are kept in an audit log.
- **Abuse limits.** Assistant and session endpoints are rate-limited with salted identifiers.
- **LLM safety.** Event context and visitor text are passed as untrusted data, contact details are redacted before reaching the model, and the model cannot change an itinerary.
- **Legacy operator token.** `ADMIN_TOKEN` is a break-glass header for scripts; leave it unset in production and use organizer logins.
- **Hardening.** Health checks expose no internals; both apps send `frame-ancestors 'none'`, `nosniff`, a strict referrer policy and a minimal `Permissions-Policy`; backups are encrypted with AES-256-GCM.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Repository map

| Path | What it is |
|---|---|
| `app/` | Visitor web app and visitor API (Next.js) |
| `admin/` | Organizer app and organizer API (Next.js) |
| `packages/engine/` | Deterministic planner, coordinator, simulation |
| `packages/contracts/` | Shared API contracts |
| `prisma/` | Schema, migrations, seed |
| `scripts/` | Local workflow, smoke tests, backup, import, simulation, screenshots |
| `data/sources/` | The season data: team records, zone positions, verified prices (`npm run catalog:build` turns them into the published catalog) |
| `docs/` | Architecture decisions, API contract, runbooks, evaluation, simulation, brand identity |

## Documentation

| Topic | Document |
|---|---|
| Product direction and build plan | [MASTER_BUILD_PLAN.md](docs/MASTER_BUILD_PLAN.md) · [PRODUCT_PLATFORM_PLAN.md](docs/PRODUCT_PLATFORM_PLAN.md) |
| Working on the code (people and AI agents) | [AGENTS.md](AGENTS.md) · [AI_AGENT_CONTEXT.md](docs/AI_AGENT_CONTEXT.md) |
| Database schema · architecture decisions | [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) · [docs/decisions](docs/decisions) |
| API contract | [docs/api](docs/api) |
| Running it · operations · venue pilot | [RUNBOOK_LOCAL.md](docs/RUNBOOK_LOCAL.md) · [OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md) · [VENUE_PILOT_RUNBOOK.md](docs/VENUE_PILOT_RUNBOOK.md) |
| Privacy and retention | [RETENTION.md](docs/RETENTION.md) · [llm-data-flow.md](docs/privacy/llm-data-flow.md) |
| Evaluation and simulation | [AI_EVAL.md](docs/AI_EVAL.md) · [SIMULATION.md](docs/SIMULATION.md) · [docs/eval](docs/eval) |
| Brand identity | [BRAND_IDENTITY.md](docs/BRAND_IDENTITY.md) |

<div dir="rtl">

## فريق ونيس

| الاسم | الدور |
|---|---|
| منصور العنزي | قائد الفريق · تطوير حلول الذكاء الاصطناعي |
| صالح العنزي | تطوير الواجهة الأمامية · علم البيانات |
| عبدالرحمن العنزي | تطوير الواجهة الخلفية · الأمن السيبراني |
| رياض العنزي | البحث وضمان الجودة · الأمن السيبراني |

</div>
