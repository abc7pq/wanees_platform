<p align="center">
  <img src="app/public/brand/logo.webp" height="110" alt="ونيس WANEES">
</p>

<h3 align="center">الونيس اللي بيونسك</h3>

<p align="center">
  مرشد شخصي بالعربي للمواسم والمهرجانات: قل له وش بالك بجملة، ويرتّب لك ليلتك.<br>
  An Arabic-first personal guide for seasons and festivals: say what you want in one sentence, and WANEES plans your night.
</p>

<p align="center">
  <a href="https://wanees.win"><b>جرّب ونيس</b></a> ·
  <a href="https://admin.wanees.win">لوحة المنظّم</a> ·
  <a href="#run-it-locally">Run it locally</a>
</p>

<p align="center">
  <a href="https://github.com/abc7pq/wanees_platform/actions/workflows/ci.yml"><img src="https://github.com/abc7pq/wanees_platform/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/Node.js-26-8e2bff" alt="Node.js 26">
  <img src="https://img.shields.io/badge/Next.js-15-4a05a6" alt="Next.js 15">
  <img src="https://img.shields.io/badge/PostgreSQL-16-0066ff" alt="PostgreSQL 16">
  <img src="https://img.shields.io/badge/UI-Arabic%20RTL-ff1e8d" alt="Arabic RTL">
</p>

<p align="center">
  <img src="docs/screenshots/02-talk.png" width="200" alt="قل لي وش بالك: جملة وحدة بدل الاستبيان">
  <img src="docs/screenshots/03-plan-next-step.png" width="200" alt="مسارك الليلة مع خطوتك الجاية">
  <img src="docs/screenshots/04-change-proposal.png" width="200" alt="تأخر عرض: ونيس يقترح بديلًا وينتظر موافقتك">
  <img src="docs/screenshots/09-dark.png" width="200" alt="الوضع الداكن الاختياري (أنا ← المظهر) بالبنفسجي الليلي من دليل الهوية">
</p>

<div dir="rtl">

## كيف يشتغل

1. **قل له وش بالك.** جملة وحدة، كتابة أو صوت: «معي عيالي، ولدي عمره 6 ويحب الطيران». بدون استبيان.
2. **يرتّب لك الليلة.** محرك حتمي يحسب المحطات والأوقات والأسعار والمشي من كتالوج الفعالية المنشور، على وقتك وميزانيتك ومن معك.
3. **يمشي معك.** تأخر عرض أو زاد الزحام؟ يقترح بديلًا مع السبب، وأنت اللي تقرر. وإذا أُغلق نشاط يشيله من مسارك مباشرة.

أول فعالية عليه: **بوليفارد وورلد، موسم الرياض 2026-27**.

> **القاعدة: الكمبيوتر يحسب، والوكيل يفهم ويشرح، والزائر يقرر.**
> النموذج اللغوي ما يقرر محطة ولا سعر ولا وقت. يفهم الطلب ويشرح، وحارس `groundingViolations` يرفض أي رد فيه رقم مو موجود في بيانات المحرك. وبدون مفتاح ذكاء اصطناعي يشتغل كل شيء بردود حتمية من نفس البيانات.

## للزائر

- **تطبيق جوال على الويب:** شريط تنقل سفلي (ونيس، مساري، الخريطة، حولي، أنا)، قوائم منبثقة، زر الرجوع يقفلها، ويتثبّت على الشاشة الرئيسية ويشتغل لو ضعف الاتصال.
- **«خطوتك الجاية»:** وش المحطة، كم باقي عليها، وكم دقيقة مشي، وزر واحد «دلّني عليها».
- **دلّني:** توجيه حي من GPS الجوال على ممرات الموقع، وموقعك الدقيق يبقى في جوالك.
- **حولي:** أقرب دورة مياه، أكل، مصلى، إسعاف أو مكان ترتاح فيه، بدقائق المشي الفعلية.
- **مساعد سعودي بالنص والصوت:** يعدّل مسارك، يشرح «ليش هذي المحطة؟»، ويرد بالعربي أو الإنجليزي أو الفرنسي أو الأردو.
- **خصوصي افتراضيًا:** بدون اسم ولا جوال، جلسة مجهولة بكوكي `HttpOnly`، والرسائل منقّحة وتنتهي بعد 24 ساعة، وزر يحذف بيانات زيارتك.

<p align="center">
  <img src="docs/screenshots/08-stop-menu.png" width="200" alt="قائمة المحطة: اتجاهات، خريطة، ليش، بدّل، شيل، شارك">
  <img src="docs/screenshots/05-assistant.png" width="200" alt="مساعد ونيس">
  <img src="docs/screenshots/10-rating.png" width="200" alt="كيف كانت ليلتك مع ونيس؟ بوجوه ونيس الخمسة">
  <img src="docs/screenshots/01-home.png" width="200" alt="الصفحة الرئيسية">
</p>

## للمنظّم

- **انشر تأخيرًا أو إغلاقًا،** وكل مسار متأثر يستجيب: الإغلاق فورًا، والتأخير والزحام اقتراح صالح 15 دقيقة يُعتمد داخل معاملة قاعدة بيانات.
- **لوحة تشغيل حية `/ops`:** إشغال المناطق، الانتظار، توقعات المسارات، وطلبات مساعدة الزوار، بدون أي معرّف زائر.
- **كتالوج بإصدارات:** مسودة، مراجعة، نشر، تراجع. والزائر يكمل على النسخة اللي بدأ فيها.
- **حوافز توزّع الحركة** («قهوتك علينا») بمكان وصلاحية، و**«مسرح الحركة» `/ops/theater`** لتجربة أثر تأخير قبل نشره.
- **أكثر من فعالية ومنظمة:** كل استعلام محصور بمنظمته وفعاليته، مع سجل تدقيق.

<p align="center">
  <img src="docs/screenshots/06-ops-dashboard.png" width="410" alt="لوحة المشغّل">
  <img src="docs/screenshots/07-organizer.png" width="410" alt="لوحة إدارة المنظّم">
</p>

## الحقيقي والمحاكى

| حقيقي | محاكى أو تقديري، ومعلَّم كذا في الواجهة |
|---|---|
| 111 سجلًا جمعها الفريق، مصحّحة على دليل موسم 2026-27 الرسمي | مواعيد العروض والإقبال المتوقع (الموقع ما ينشر جدولًا) |
| 23 منطقة بمواقعها من صور الأقمار الصناعية وخريطة الموقع | عدّادات البوابات: تحتاج أجهزة في الموقع |
| الطقس الحي، تحديثات المشغّل، ومواقع الأجهزة اللي وافقت | أسعار الأنشطة: تقدير الفريق، وتظهر كأسعار تقريبية |
| المساعد بالنص والصوت عند ضبط مفتاح OpenAI | أرقام الأثر من محاكاة حتمية: وقوف جمهور العرض المتأخر **30.6 ← 21.2 دقيقة** ([SIMULATION.md](docs/SIMULATION.md))، وليست قياسًا ميدانيًا |

`npm run claims:audit` يتحقق في CI إن أرقام العرض ما نزلت عن البيانات المشحونة.

## الهوية البصرية

مطبّقة حسب «دليل الهوية البصرية — ونيس»: البنفسجي `#8E2BFF` مع التيل والأزرق والوردي والبرتقالي والأصفر، IBM Plex Sans Arabic و Inter، تميمة ونيس ووجوهه الخمسة في التقييم، أيقونات خطية بلا إيموجي، والفاتح هو الأصل، مع وضع داكن اختياري بالبنفسجي الليلي من «أنا ← المظهر». التفاصيل: [BRAND_IDENTITY.md](docs/BRAND_IDENTITY.md).

</div>

## For developers

### Architecture

```mermaid
flowchart LR
  V[Visitor web app<br/>Next.js · Arabic RTL · PWA] -->|cookie session| API
  O[Organizer app<br/>Next.js · scrypt logins] -->|event-scoped API| API
  subgraph API[Visitor & organizer APIs]
    E[Deterministic planner<br/>time · budget · ages · shows · walking]
    C[Season coordinator<br/>capacity · demand · incentives]
    A[Assistant<br/>intent + catalog tools + grounding guard]
  end
  A -->|intent + conversation| L[(OpenAI Responses)]
  V -.->|voice over WebRTC<br/>2-minute ephemeral key| R[(OpenAI Realtime)]
  R -.->|ask_wanees_engine tool| A
  API -.->|due nudges| P[(Web Push)]
  API -->|current weather| W[(Open-Meteo)]
  API -.->|optional registration| S[(Twilio Verify)]
  API --> DB[(PostgreSQL · Prisma<br/>catalog versions · sessions · updates · audit)]
```

The planner (`app/engine/route.ts`) and the shared domain services in `packages/engine/` (coordinator, simulation, walkway graph, event clock) own every stop, price and time. The model classifies requests and talks; it never changes an itinerary. Dashed lines are optional: voice needs `OPENAI_API_KEY`, Web Push needs VAPID keys (`npm run push:keys`), and SMS runs only when an organizer turns on `WANEES_FEATURE_VISITOR_REGISTRATION` (off by default).

### Run it locally

You need **Node.js 26** (`.nvmrc`) and **PostgreSQL 16+** (local, or `docker compose up -d postgres`).

```bash
git clone https://github.com/abc7pq/wanees_platform.git
cd wanees_platform

# Install, write the local env files, create + migrate + seed the database.
# The OpenAI key is optional: planning works without it.
DATABASE_URL="postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public" \
OPENAI_API_KEY="sk-..." \
npm run setup

npm run start:local      # apply new migrations, build and start both apps (add -- --force after changes)
npm run verify:local     # in a second terminal: check everything against the running apps
```

On Windows PowerShell, set the variables first: `$env:DATABASE_URL="..."; npm run setup`.

| Open | URL |
|---|---|
| Visitor app | http://localhost:3100/e/boulevard-world-demo |
| Landing page | http://localhost:3100 |
| Operator view | http://localhost:3100/ops |
| Organizer app | http://localhost:3200 (`owner@wanees.demo`, password printed by `npm run setup`) |

### Checks

| What | Command |
|---|---|
| Unit, contract and accessibility suites | `npm test --prefix app` · `npm test --prefix admin` |
| Architecture boundaries · OpenAPI contract | `npm run test:architecture` · `npm run test:contract` |
| Database: schema, seed, retention, encrypted backup and restore | `npm run db:smoke` · `npm run test:retention` · `npm run db:backup && npm run db:restore-smoke` |
| Full HTTP flow · the presentation story end to end | `npm run test:http` · `npm run test:deck-story` |
| Browser suite on Chromium, Firefox and WebKit, light and dark | `npm run test:ui` (needs a throwaway `WANEES_UI_DATABASE_URL`) |
| README screenshots | `node --env-file=admin/.env.local scripts/capture-screens.mjs` |

CI runs all of these (except the screenshots) on every pull request and push to `main`, plus `npm audit`, both production builds and a committed-key scan.

### Security and privacy

- Secrets stay on the server in ignored `.env.local` files; the browser never sees a key, and the voice call gets a two-minute ephemeral key.
- Visitors are anonymous by default: a random token stored hashed, in an `HttpOnly; SameSite=Lax` cookie. Organizer passwords use scrypt.
- Every organizer query is scoped to its organization and event; updates are idempotent and audited; sensitive endpoints are rate-limited.
- Visitor text reaches the model as untrusted data, with emails and phone numbers redacted. See [llm-data-flow.md](docs/privacy/llm-data-flow.md) and [RETENTION.md](docs/RETENTION.md).
- Report vulnerabilities privately: [SECURITY.md](SECURITY.md).

### Repository

| Path | What it is |
|---|---|
| `app/` | Visitor web app and visitor API; the planner is `app/engine/route.ts` |
| `admin/` | Organizer app and organizer API |
| `packages/engine/` · `packages/contracts/` | Shared domain services · shared API contracts, error codes, feature flags |
| `prisma/` | Schema, migrations, seed (Boulevard World plus a small second event to prove isolation) |
| `data/sources/` | Season data; `npm run catalog:build` turns it into the published catalog |
| `scripts/` · `tests/ui/` | Local workflow, smokes, backup, import, simulation · browser suite |
| `docs/` · `deploy/` | Plans, decisions, API, runbooks, brand ([index](docs/README.md)) · production setup ([Hetzner](deploy/hetzner/README.md)) |

Start with the [documentation index](docs/README.md), [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Changes are in [CHANGELOG.md](CHANGELOG.md).

<div dir="rtl">

## فريق ونيس

بدأ ونيس حلًّا لتحدي «خدمة المرشد الشخصي الذكي التفاعلي» في هاكاثون agentX الرابع بشراكة الهيئة العامة للترفيه، ويُطوَّر الآن منتجًا لأكثر من فعالية.

| الاسم | الدور |
|---|---|
| منصور العنزي | قائد الفريق · تطوير حلول الذكاء الاصطناعي |
| صالح العنزي | تطوير الواجهة الأمامية · علم البيانات |
| عبدالرحمن العنزي | تطوير الواجهة الخلفية · الأمن السيبراني |
| رياض العنزي | البحث وضمان الجودة · الأمن السيبراني |

</div>

<p align="center"><sub>All rights reserved (no license granted yet).</sub></p>
