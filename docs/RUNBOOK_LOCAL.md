# دليل التشغيل المحلي — WANEES

هذا الدليل يشرح تشغيل منصة وُنيس كاملة على جهاز محلي: تطبيق الزائر، لوحة الإدارة، وقاعدة PostgreSQL.
بيئة الأساس التي استُخدمت للتحقق المحلي:

- Windows 11، Windows PowerShell 5.1 (`powershell.exe`؛ PowerShell 7 مدعوم أيضًا)
- Node.js 26.13.1 (`.nvmrc` يثبّت 26.12.1، وCI يستخدم 26)
- PostgreSQL 17 (خدمة محلية على `localhost:5432`)
- npm 11.20.0

تاريخ آخر لقطة قبول محلي والنتائج التفصيلية موجودان في القسم 10. لا تفترض أن كل
الأوامر في هذا الدليل نُفذت في جلسة واحدة أو على نسخة إنتاجية.

## 1. المتطلبات

| المتطلب | الإصدار | ملاحظات |
|---|---|---|
| Node.js | 26 أو أحدث | مطلوب في `app/package.json` و`admin/package.json` |
| npm | 10+ | |
| PostgreSQL | 16+ | 17 مُختبَر |
| Docker | اختياري | فقط لتشغيل Postgres عبر `docker-compose.yml` |

على Windows، إذا ظهر الخطأ `npm.ps1 cannot be loaded because running scripts is disabled`، استخدم
`npm.cmd` بدل `npm`، أو نفّذ مرة واحدة:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 2. التهيئة الأولى (نسخة نظيفة)

من جذر المستودع:

```powershell
npm ci                      # أدوات قاعدة البيانات وPrisma
npm ci --prefix app         # تطبيق الزائر
npm ci --prefix admin       # لوحة الإدارة

copy .env.example .env                  # أدوات الجذر؛ على Linux/macOS: cp .env.example .env
copy .env.example app\.env.local        # خادم Next.js للزائر
copy .env.example admin\.env.local      # خادم Next.js للإدارة
```

أدوات قاعدة البيانات من الجذر تقرأ `.env`، لكن Next.js يقرأ ملفات البيئة من مجلد
كل تطبيق ولا يبحث في المجلد الأب. لذلك انسخ القيم المشتركة إلى `app/.env.local`
و`admin/.env.local` أيضًا. إذا أبقيت `app/.env.local`، فهو يتقدم على `.env` في
أدوات الجذر كذلك.

في ملفات البيئة المحلية، الحد الأدنى المطلوب:

```text
DATABASE_URL="postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public"
NEXT_PUBLIC_APP_URL="http://localhost:3100"
ADMIN_APP_URL="http://localhost:3200"
WANEES_ORGANIZATION_SLUG="wanees-demo"
VISITOR_API="http://127.0.0.1:3100"
ADMIN_TOKEN="local-test-token"
```

لـ`test:http`، ضع `VISITOR_API` و`ADMIN_TOKEN` في `admin/.env.local`، واستخدم
قيمة `ADMIN_TOKEN` نفسها عند تشغيل لوحة الإدارة وفي نافذة الاختبار. على Linux/macOS
استخدم `cp` مع الشرطات المائلة `/` بدل أوامر `copy` أعلاه.

`DATABASE_URL` إلزامي حتى لو كانت قاعدة البيانات تعمل: فحص `/api/health` يعتبر القاعدة
«غير مهيأة» ويعيد `503` إذا لم يكن المتغير معرّفًا. لا تضع ملف `.env` في Git.

للسوالف عبر OpenAI، ضع `OPENAI_API_KEY` في `app/.env.local` فقط، وأعد تشغيل
تطبيق الزائر. النموذج الافتراضي `gpt-6-luna`، ويمكن ضبطه عبر `WANEES_OPENAI_MODEL`.
اختبر رسالة عربية مثل «يا ونيس، خلنا نسولف» ثم اسأل عن نشاط معروف. يعمل المسار
والاتجاهات دون المفتاح. اختبر إذن الموقع على HTTPS أو localhost، مع اختبار
رفض الإذن ونقطة البداية اليدوية أيضًا.

من شاشة ونيس افتح «مكالمة»، ثم اضغط «ابدأ المكالمة» واسمح للمتصفح بالميكروفون.
اختبر دورين متتاليين، وإنهاء المكالمة أثناء الرد، والرجوع إلى الكتابة. المتصفح
يتولى معالجة الصوت، وواجهة ونيس تستقبل النص ضمن جلسة الزائر الحالية.

بعد التثبيت، ولّد عميل Prisma مرة واحدة (يحتاجه `dev`، أما `build` فيولّده تلقائيًا):

```powershell
npm run db:generate
npm run db:validate
```

## 3. قاعدة البيانات

### خيار A — PostgreSQL مثبّت على الجهاز

أنشئ المستخدم والقاعدة (مرة واحدة، بصلاحيات مدير PostgreSQL):

```sql
CREATE USER wanees WITH PASSWORD 'wanees_dev';
CREATE DATABASE wanees OWNER wanees;
```

ثم من جذر المستودع:

```powershell
npm run db:deploy     # تطبيق الهجرات الموجودة (migrate deploy)
npm run db:seed       # بيانات بوليفارد وورلد + الفعالية الثانية
npm run db:smoke      # فحص المخطط والبيانات
```

`db:seed` يحتاج `WANEES_OWNER_PASSWORD` في `app/.env.local` (أو في `.env` إذا لم
يوجد الملف المحلي) فقط إذا أردت دخول المنظم `owner@wanees.demo` بكلمة مرور دائمة.
بدونه يبقى `ADMIN_TOKEN` مسار الطوارئ.

لحساب عرض بصلاحية مدير في بيئة الاختبار، ضع `DATABASE_URL` المحلي في
`admin/.env.local` ثم شغّل `npm run db:demo-admin` من جذر المستودع بعد تهيئة
منظمة العرض. يمكنك إعادة تشغيل الأمر دون إعادة تحميل بيانات الفعاليات. ينشئ الأمر
`demo-admin@wanees.demo` بصلاحية `ADMIN` في منظمة `wanees-demo` فقط،
ويضع `WANEES_LOCAL_DEMO=true` وكلمة مرور العرض في ملف الإدارة المحلي المتجاهل في Git.
أعد تشغيل الإدارة على loopback، مثل `npm --prefix admin run start -- -H 127.0.0.1 -p 4200`،
وافتح [صفحة الدخول المحلية](http://127.0.0.1:4200/login). تجد البريد وكلمة المرور
في مربع العرض أسفل اليمين وتستخدمهما في نموذج الدخول العادي.

على VPS اترك `WANEES_LOCAL_DEMO` و`WANEES_DEMO_ADMIN_PASSWORD` بدون إعداد،
وشغّل أداة تهيئة حساب العرض على قاعدة الاختبار المحلية فقط. إعداد
`WANEES_DEMO_PASSWORD` في seed يخص حساب القراءة `demo@wanees.demo` القديم.

### خيار B — Docker

```powershell
docker compose up -d postgres
npm run db:deploy
npm run db:seed
npm run db:smoke
```

### فحص سريع للقاعدة

```powershell
psql "postgresql://wanees:wanees_dev@localhost:5432/wanees" -c 'select slug, status from "Event";'
```

المتوقع: فعاليتان على الأقل، إحداهما `boulevard-world-demo` والأخرى `sample-festival`.

## 4. تشغيل التطوير

```powershell
npm run --prefix app dev       # http://localhost:3100
npm run --prefix admin dev     # http://localhost:3200
```

بدون PostgreSQL يعرض تطبيق الزائر بيانات JSON كـ fallback تجريبي موسوم بوضوح،
لكن الصحة تعود `503` والجلسات الدائمة لا تعمل.

## 5. تشغيل نسخة إنتاج محليًا

```powershell
npm run --prefix app build
npm run --prefix admin build

npm run --prefix app start     # 127.0.0.1:3100
npm run --prefix admin start   # 127.0.0.1:3200
```

`build` يشغّل `prisma generate` تلقائيًا (prebuild). كل بناء يمر بفحص TypeScript كامل.
إذا كان خادم `dev` يعمل من نفس checkout، أوقفه قبل `build` ثم أعد تشغيله بعد البناء؛
كلاهما يستخدم مجلد `.next`، وتشغيلهما معًا قد يترك خادم التطوير بملفات chunks غير متطابقة.

## 6. التحقق بعد التشغيل

### فحص الصحة

```powershell
curl.exe -s http://127.0.0.1:3100/api/health
curl.exe -s http://127.0.0.1:3200/api/health
```

المتوقع `200` مع:

```json
{"status":"ok","service":"wanees-visitor-web"}
{"status":"ok","service":"wanees-admin-web"}
```

`503` مع `"status":"degraded"` يعني أن `DATABASE_URL` غير معرّف أو القاعدة غير متاحة.

### المسارات المتوقعة

تطبيق الزائر `:3100`:

| المسار | المتوقع |
|---|---|
| `/` | 200 |
| `/demo` | 200 |
| `/ops` | 200 |
| `/events/boulevard-world-demo` | 200 |
| `/api/health` | 200 |
| `/api/events/boulevard-world-demo` | 200 |
| `/api/events/sample-festival` | 200 |
| مسار غير موجود | 404 |

لوحة الإدارة `:3200` (بدون جلسة):

| المسار | المتوقع |
|---|---|
| `/login` | 200 |
| `/` | 307 إلى `/login` |
| `/events` | 307 إلى `/login` |
| `/venues` | 307 إلى `/login` |
| `/api/health` | 200 |
| `/api/v1/events` | 401 |
| مسار غير موجود | 404 |

### الاختبارات

```powershell
npm test --prefix app      # المحرك، إعادة التخطيط، التعقيد، a11y، أمان المحادثة، العقود
npm test --prefix admin    # ربط تسميات الدخول، تجزئة كلمات المرور
```

### تدفق HTTP الكامل

يتطلب تشغيل التطبيقين وقاعدة بيانات مزروعة. عرّف نفس `ADMIN_TOKEN` عند تشغيل الإدارة
وعند تنفيذ الاختبار:

```powershell
$env:ADMIN_TOKEN = "local-test-token"
$env:VISITOR_API = "http://127.0.0.1:3100"
npm run --prefix admin start   # في نافذة أخرى، بنفس المتغير

npm run test:http
```

إن شغّلت على منافذ غير 3100/3200:

```powershell
$env:WANEES_BASE_URL = "http://127.0.0.1:3101"
$env:WANEES_ADMIN_BASE_URL = "http://127.0.0.1:3201"
```

يغطي الاختبار: عزل الفعالية الثانية، جلسة كوكي HttpOnly، إنشاء المسار، سؤال المرشد،
التحديثات التشغيلية (إغلاق + ازدحام)، الإلغاء وسجل التدقيق، وإعادة التخطيط بعد الإلغاء.
ينتهي بسطر JSON يحوي `"revocation":"passed"`.

### اختبارات المتصفح (Playwright)

تعمل فقط على حزمة مشغّلة بقاعدة بيانات مؤقتة: خادم Postgres مستقل (مثل نسخة `pg_dump` على منفذ آخر) أو قاعدة بيانات منفصلة. مخطط (schema) جديد داخل قاعدة `wanees_final` لا يُعدّ عزلًا. يرفض `tests/ui/db-guard.mjs` التشغيل إن لم يُعرَّف `WANEES_UI_DATABASE_URL`، أو إن طابق الخادم وقاعدة البيانات `DATABASE_URL` الحقيقي، أو إن لم تُحدَّد عناوين الحزمة صراحةً.

```powershell
$env:WANEES_UI_DATABASE_URL = "postgresql://…@127.0.0.1:5499/wanees?schema=wanees_final"  # نفس قيمة DATABASE_URL للحزمة المؤقتة
$env:WANEES_BASE_URL = "http://127.0.0.1:4101"
$env:WANEES_ADMIN_BASE_URL = "http://127.0.0.1:4201"
npm run test:ui
```

### عقد API وIdempotency

مع تشغيل تطبيق الزائر، تحقّق من البنية والمطابقة الحية وإعادة التشغيل:

```powershell
npm run test:contract
powershell.exe -NoProfile -ExecutionPolicy Bypass -File docs/api/contract-test.ps1 -Base http://127.0.0.1:3100
npm run test:idempotency
```

على Linux/macOS استخدم `pwsh` بدل `powershell.exe`. فحص المطابقة يغطي كل عمليات
الزائر الموثقة، أما `test:idempotency` فيتحقق من أن إعادة `POST /itinerary` و
`POST /itinerary/replan` لا تنشئ سجلات مكررة.

## 7. تعارض المنافذ

إذا ظهر `EADDRINUSE`:

```powershell
Get-NetTCPConnection -LocalPort 3100 -State Listen | Select-Object LocalPort,OwningProcess
Get-Process -Id <OwningProcess> | Select-Object Id,ProcessName,Path
```

أوقف النسخة المكررة (`Stop-Process -Id <pid>`) ثم أعد التشغيل. لا تشغّل نسختين
على نفس المنفذ؛ الجلسات والكوكيز وروابط الإدارة سترتبك.

## 8. أعطال شائعة

| العرض | السبب | الحل |
|---|---|---|
| `npm.ps1 cannot be loaded` | سياسة تنفيذ PowerShell | استخدم `npm.cmd` أو `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `EPERM: operation not permitted, utime ...\Prisma\...` | مجلد cache الخاص بـ Prisma غير قابل للكتابة (بيئات مقيدة) | قبل البناء، وجّه `APPDATA` إلى مجلد قابل للكتابة داخل مساحة العمل: `$env:APPDATA = "$PWD\.prisma-cache"` |
| تحذير `Prisma only supports Node.js versions 20.19+, 22.12+, 24.0+` | Prisma 7.10.1 لا يعلن دعم Node 26 بعد | تحذير فقط؛ `generate` و`build` و`db:*` نجحت على 26.13.1. عند مفاجأة، ثبّت Node 26.12.1 من `.nvmrc` |
| `/api/health` = 503 | `DATABASE_URL` غير معرّف أو Postgres متوقف | راجع `.env` ثم `Get-Service postgresql*` |
| `EADDRINUSE` | نسخة أخرى تعمل | القسم 7 |
| فشل `db:seed` | المستخدم/القاعدة غير موجودين أو الهجرات لم تُطبّق | `npm run db:deploy` ثم أعد المحاولة |

## 9. النسخ الاحتياطي والاستعادة (اختياري)

```powershell
$env:WANEES_BACKUP_DIR = "C:\backups\wanees"
$env:WANEES_BACKUP_ENCRYPTION_PASSPHRASE = "<مفتاح قوي خارج Git>"
npm run db:backup
npm run db:restore-smoke   # يحتاج WANEES_RESTORE_SMOKE_DATABASE_URL
```

## 10. سجل التحقق الأخير

| التاريخ (Asia/Riyadh) | الفحص | النتيجة |
|---|---|---|
| 2026-11-23 | `npm run db:deploy` | نجح؛ وُجدت 12 هجرة، ولا توجد هجرات معلّقة |
| 2026-11-23 | `npm run db:seed` | نجح؛ Boulevard World: 24 منطقة و59 نشاطًا، مع كتالوج `sample-festival` المعزول |
| 2026-11-23 | `npm run db:validate` | مخطط Prisma صالح |
| 2026-11-23 | `npm run db:smoke` | نجح؛ 28 عقدة مسار، 54 حافة، و59 نشاطًا |
| 2026-11-23 | `npm test --prefix app` | نجحت اختبارات تطبيق الزائر |
| 2026-11-23 | `npm test --prefix admin` | نجحت اختبارات لوحة الإدارة وإتاحة الدخول |
| 2026-11-23 | `npm run --prefix app build` و`admin build` | نجح البناءان وفحص TypeScript؛ ظهر تحذير Sentry غير حاجب متعلق بـ`pg` |
| 2026-11-23 | `npm run test:contract` | 14 مسارًا، 19 عملية، 39 schema، و0 مشاكل بنيوية |
| 2026-11-23 | `contract-test.ps1` | 36/36 فحصًا حيًا ناجحًا، بما فيها replay و`IDEMPOTENCY_KEY_REUSED` |
| 2026-11-23 | `npm run test:idempotency` | نجح؛ أُعيدت النتيجة الأصلية ولم تُنشأ سجلات مكررة |
| 2026-11-23 | `npm run test:http` | نجح؛ `revocation: passed` |
| 2026-11-23 | `/api/health` على 3100 و3200 | HTTP 200 للتطبيقين |

### Release-risk register

The local release candidate deliberately accepts three application-level
idempotency gaps; PostgreSQL, authorization, and the tested visitor replay paths
are not blocked. The owner for all three is **Backend**:

| Surface | Risk | Mitigation in this release | Required acceptance before public rollout |
|---|---|---|---|
| Operator `updates` create/revoke | A retried create can duplicate an update and linked crowd snapshot; revoke is safe on repeat but has no replay key. | Same-origin/operator authorization, rate limits, transaction, audit log, and UI submit-state protection. | Add scoped idempotency and prove one update/snapshot/audit on create replay and one audit on revoke replay. |
| Operator `incentives` create/update | A retried create can duplicate an incentive; repeated edits are last-write-wins. | Same-origin/operator authorization, rate limits, transaction, and audit log. | Add scoped idempotency and prove same-key replay, different-body `409 IDEMPOTENCY_KEY_REUSED`, and no duplicate audit. |
| Visitor `POST /session` | A network retry can create a second visitor session. | Rate limit, opaque token hash, event scope, expiry/retention, and idempotent delete. | Add an event-scoped client attempt key (or equivalent retry token) and prove retry returns one session row. |

The current replay gate covers only `POST /itinerary` and
`POST /itinerary/replan`; these three boundaries are release risks, not silently
passed acceptance criteria. They are acceptable for this local RC and are not a
public-deployment approval.

هذه لقطة قبول محلي وليست إعلان نشر عام. الشجرة المصدر الحالية مستودع Git؛ لا
تحذف `.git` عند إعادة التحقق. أعد تشغيل خادمي التطوير بعد أي `build` على نفس checkout.
