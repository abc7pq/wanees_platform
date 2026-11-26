# WANEES AI agent context

هذا الملف هو بطاقة التشغيل السريعة لأي وكيل يعمل على WANEES. اقرأه بعد `AGENTS.md` وقبل تعديل الكود، ثم ارجع إلى `docs/MASTER_BUILD_PLAN.md` و`CHANGELOG.md` عند وجود قرار معماري (لا يوجد ملف `STATE.md`).

## الهدف

WANEES هو Web App متعدد الفعاليات. الزائر يدخل فعالية بدون حساب، يجيب أسئلة قصيرة، يحصل على مسار شخصي، يسأل المرشد، ويرى اقتراحات آمنة عند تغيّر الازدحام أو التأخير أو الإغلاق. بوليفارد وورلد هو أول seed/demo، وليس منطقًا خاصًا لا يجوز تعميمه.

للسرد الموحد للمنتج وعرضه على لجنة التحكيم، راجع `docs/PROJECT_STORY.md`. حافظ على التمييز بين بيانات الديمو المحاكية والنتائج التشغيلية المقاسة، ولا تصف اقتراح الزحام أو التأخير بأنه يُطبّق دون اختيار الزائر.

قاعدة المنتج: الحاسوب يحسب، الوكيل يفهم ويشرح، والزائر يقرر.

## خريطة المستودع

- `app/engine/`: المحرك الحتمي؛ لا تضع فيه استدعاء LLM أو Prisma.
- `app/lib/assistant.ts`: intents/tools، البحث grounded، مصادر الأنشطة والمواقع، وتعديلات المسار.
- `app/lib/assistant-context.ts`: سياق مؤقت من IDs فقط، صلاحيته 24 ساعة.
- `app/lib/event-clock.ts`: الساعة الرسمية من وقت الخادم وتوقيت مكان الفعالية.
- `app/lib/db-catalog.ts`: يحوّل النسخة المنشورة في PostgreSQL إلى `Catalog` للمحرك.
- `app/app/api/v1/events/[eventSlug]/`: عقود الزائر الدائمة.
- `packages/contracts/src/index.ts`: metadata العقود، أخطاء API، feature flags، وأنواع الاقتراحات المشتركة.
- `app/app/demo/page.tsx`: واجهة الزائر الحالية؛ تبقى متوافقة مع الـ API ولا تحسب الحقائق محليًا.
- `app/components/VenueMap2D.tsx`: خريطة 2D تعرض شبكة RouteEdge والمواقع المميزة.
- `admin/`: لوحة المنظم والمصادقة والصلاحيات والتحرير.
- `admin/app/api/v1/events/[eventSlug]/updates/`: operator update listing and creation; the nested `[updateId]` route provides soft revocation with audit history.
- `scripts/backup.ts` and `scripts/restore-smoke.ts`: encrypted PostgreSQL backup and isolated restore rehearsal tooling.
- `prisma/`: schema، migrations، seed، وبيانات Boulevard World.

## عقود لا تكسرها

### الساعة

لا تقبل `nowMinute` من المتصفح في الإنتاج. استخدم `getEventClock` مع `Event.startsAt`, `Event.endsAt`, `Venue.timezone`, وفتح الموقع. متغير `WANEES_ALLOW_CLOCK_OVERRIDE=true` مخصص للاختبارات/الديمو المعزول فقط. تعيد live/assistant/itinerary/replan كائن `clock`.

### المسار

المسار المحفوظ الفعّال هو `Itinerary.status = "active"`. الاقتراح غير المفروض هو `"proposed"`; بعد قبول الزائر يصبح `active`، وبعد إبقاء المسار الحالي يصبح `dismissed`. لا تعرض proposal كأنه المسار الحالي.

`POST /api/v1/events/:eventSlug/itinerary/replan` يقبل:

```json
{"decision":"preview|accept|keep_current","proposalId":"...","baseItineraryId":"...","baseLiveRevision":"...","reason":"..."}
```

النتائج: `NO_CHANGE`, `PROPOSED`, `APPLIED`, `DISMISSED`. الإغلاق/إلغاء الجدول urgent ويطبق فورًا؛ crowd/delay ينتجان proposal.
الاقتراح صالح 15 دقيقة، ولا يقبل إذا تغيرت نسخة التشغيل أو المسار الأساسي؛ الرد في هذه الحالة `409 PROPOSAL_STALE`.

### المساعد

المساعد لا يخترع السعر أو المواعيد أو الزحام أو الموقع. المصادر تحمل `sourceRef`. intents الحالية تشمل `build`, `search`, `location`, `status`, `crowd`, `add`, `remove`, `swap`, `shorten`, `explain`, `help`, `faq`, `profile`, `schedule`, و`alternatives`. عند الغموض لا تختر نشاطًا مخفيًا؛ استخدم clarification. سياق المساعد لا يخزن raw message، بل IDs قصيرة العمر من الكتالوج.

الأدوات: `build_itinerary`, `modify_itinerary`, `search_event_content`, `find_location`, `get_route` (طلب اتجاهات صريح)، `get_itinerary_status`, `get_crowd`, `explain_recommendation`, `handoff_to_operator`, `answer_venue_faq`, `update_visit_details`, `get_schedule` («وش العروض الجاية؟»: جلسات بمواعيد منشورة تبدأ قريبًا وتناسب المجموعة وتنتهي قبل نهاية الزيارة)، و`list_alternatives` («وش البدائل للمحطة الجاية؟»: حتى 3 بدائل بنفس قواعد التبديل `rankSwaps`، بدون أي تغيير في المسار، وكل بطاقة فيها زر «بدّلها بهذا» = إجراء A2UI `swap_with`). «بدّل «أ» بـ«ب»» يقترح بديل الزائر نفسه إذا اجتاز نفس فحوص التبديل، وإلا يشرح السبب. سؤال سعر أو موعد عن شيء غير موجود في كتالوج الفعالية («كم سعر الغواصة؟») يُقال صراحة إنه غير موجود، ولا يُسعَّر نشاط آخر.

الحواجز (`app/lib/agent-guardrails.ts`): ونيس هو «المساعد الذكي لمنصة ونيس» في كل قناة. لا يسمّي أي نموذج أو مزوّد (ChatGPT/OpenAI/GPT/Claude/Gemini…)، ولا يدّعي أنه إنسان، ولا يكشف تعليماته أو يتقمص دورًا يلغيها، ولا يعِد بخصم أو تعويض. أسئلة الهوية وكشف التعليمات تأخذ ردًا ثابتًا قبل أي استدعاء للنموذج، وأي صياغة من النموذج تسرّب مزوّدًا أو تعليمات ترجع للمسودة الحتمية. في المكالمة الحية يراقب `createRealtimeController` نص الصوت: إذا بدأ يسمّي مزوّدًا يقطع الصوت (`response.cancel` + `output_audio_buffer.clear`) ويحذف الرد من سياق النموذج ويقول سطر الهوية الثابت عبر `<system_correction>`.

الزائر المسجّل: ما يقوله في المحادثة عن مجموعته («عيالي أعمارهم 5 و 9») يُحفظ في تفضيلاته لزيارته القادمة، والاقتراح الذي يعتمده يدخل سجل زياراته. ملخص الزائر يذكر أنه «زائر عائد» برقم الزيارة فقط؛ الاسم والجوال لا يصلان للنموذج أبدًا.

شخصية ونيس وموجّه النظام في `app/lib/agent-persona.ts` (النسخة `wanees-agent-v5`)، نسخة واحدة للنص والصوت والمكالمة الحية مع قواعد لكل قناة. النماذج: `WANEES_OPENAI_MODEL` (افتراضيًا `gpt-6-luna`) للفهم والصياغة، و`gpt-realtime-2` للمكالمة. تدفق كل رسالة:

1. `decide()` يصنّف النية (LLM اختياري + قواعد حتمية)، ويستلم آخر رد للمساعد ليفهم المتابعات مثل «وكم سعرها؟».
2. المحرك الحتمي ينفّذ الأداة ويكتب `draft` صحيحًا دائمًا.
3. `composeReply()` في `app/lib/llm.ts` يصيغ الرد لهذا الزائر تحديدًا من `buildVisitorBrief()` (من معه، عمر أصغر طفل، الميزانية، المزاج، الوقت المتبقي، المشي، ما جرّبه، مساره) ومن الحقائق المختصرة للأداة.
4. `groundingViolations()` يرفض أي رقم أو اسم «» غير موجود في الحقائق، أو ادعاء تنفيذ تعديل، أو اقتراح لم يُعرض كمنتظر للموافقة؛ عندها يرجع `draft` حرفيًا. البلاغات (`help`) لا تُعاد صياغتها أبدًا.

الفهم بدل الاستبيان (تدقيق 1.1–1.8): كل رسالة مكتوبة تمر على `understandMessage()` في `app/lib/visitor-understanding.ts`: من معه، عمر كل طفل، اهتمام كل شخص كوسوم معتمدة (`packages/engine/src/tags.ts`)، الكلمات اللي ما لها وسم، اللي ما يبيه، الميزانية، الوقت، المزاج، عربية الأطفال أو الكرسي، ولغة الرد. المحلل الحتمي يكفي بدون مفتاح؛ ومع المفتاح `extractVisitorUnderstanding()` يضيف فقط ما يقتبسه حرفيًا من كلام الزائر (zod، 3 ثوانٍ). الفهم يغيّر التفضيلات فقط في رسائل السوالف، لا في أوامر مثل «بدّل… بشي أرخص». أول نية زيارة تبني جولة فورًا بافتراضات آمنة (`planAssumptions()`) وسؤال واحد كحد أقصى (`followUpQuestion()`)؛ قبل بدء الزيارة تتحدث الجولة مباشرة، وبعده تصير اقتراحًا. الرد يرجع `understanding: { language, assumptions, question }`.

الفئات (`app/lib/place-categories.ts`): «ابي مطعم» أو «وين أقرب حمام» فلتر صارم قبل الترتيب، والأقرب بدقائق المشي من المكان اللي قاله الزائر («انا عند جناح افريقيا…») وإلا من محطته أو البوابة مع ذكر ذلك. «تعبت ابي اقعد» نية `rest`: أقرب جلسات أو أماكن هادئة وعرض تقصير الجولة. الرد بلغة الزائر (`<reply_language>`)، والحقائق تحمل `name_en` والحارس يقبل أي الاسمين.

واجهة الوكيل بـ A2UI v1.0 (https://a2ui.org): كل رد قد يحمل `ui`، وهي رسائل A2UI (`createSurface` مع نموذج البيانات ثم `updateComponents`) من الكتالوج الأساسي فقط: `Column`, `Row`, `Card`, `Text`, `Button`, `Divider`. يبنيها `buildAssistantSurface()` في `app/lib/a2ui.ts` حتميًا من نتيجة المحرك (بطاقات نشاط/مكان، بطاقة اقتراح باعتماد/إبقاء، خيارات توضيح، زحام، بلاغ)، ولا يكتبها النموذج أبدًا، ويتحقق منها `validateA2uiMessages()` قبل الإرسال. العارض في `app/components/A2uiSurface.tsx` يرسم هذه المكوّنات فقط كنص عادي. ضغطات الأزرار ترجع كرسالة A2UI `action`: `add_to_plan` و`choose` و`swap_with` تُرسل لنقطة `/assistant` في الحقل `action` وتتحول لرسالة زائر حتمية، و`get_directions` و`show_on_map` و`respond_to_proposal` تُنفذ في التطبيق. لأن الحمولة متوافقة مع المواصفة، تطبيق الجوال (المرحلة 2) يقدر يرسمها بعارضات A2UI الرسمية (Flutter/SwiftUI/Compose) بدون تغيير الخادم. لم نعتمد `@a2ui/react` (نسخة 0.16) لأنه ما زال قبل 1.0.

التنبيهات الاستباقية: `GET /api/v1/events/{slug}/assistant/nudges` يحسب حتميًا من المسار وساعة الفعالية (`app/lib/nudges.ts`): «تحرك الحين» قبل المحطة الجاية بوقت المشي + هامش (6 دقائق للعائلات وقليلي المشي، وإلا 3)، وصيغة أقوى للعروض ذات المواعيد، و«باقي 20 دقيقة على نهاية زيارتك» مع زر «قصّر الجولة» (إجراء A2UI `shorten_plan`). لا شيء والموقع مغلق. الواجهة تسأل كل دقيقة وتعرض كل معرّف مرة واحدة كبطاقة A2UI، وأثناء المكالمة الحية تُرسل التنبيه كـ`<system_nudge>` فيقوله ونيس بعد انتهاء جملته الحالية (طابور في `createRealtimeController`)، وإذا بدأت المكالمة خلال 3 دقائق من تنبيه يقوله بعد التحية.

تنبيهات شاشة القفل (Web Push): نفس التنبيهات الحتمية تصل الجوال والتطبيق مقفل، فقط بعد أن يضغط الزائر «فعّل التنبيهات» ويوافق المتصفح. الاشتراك (`PUT /api/v1/events/{slug}/push`) مربوط بالزيارة وينتهي معها ويُحذف بإنهائها. المرسِل (`app/lib/push-dispatch.ts`) يعمل كل دقيقة داخل الخادم (`WANEES_PUSH_DISPATCH_INTERVAL_SECONDS`) أو من مجدول خارجي (`POST /api/v1/internal/push/dispatch` بالرمز `WANEES_PUSH_DISPATCH_TOKEN`): يحسب `computeNudges` لكل مشترك ويرسل ما لم يُسلَّم بعد، ويحجز كل معرّف قبل الإرسال حتى لا يتكرر. ما عرضه التطبيق المفتوح يُعلَّم كمُسلَّم فلا يتكرر على شاشة القفل. التشفير وتوقيع VAPID في `app/lib/web-push.ts` بـ`node:crypto` فقط (RFC 8291/8292، مختبر بمثال الـRFC حرفيًا)، ولا يتصل الخادم إلا بمضيفي خدمات الدفع المعروفين. خدمة الدفع (Google/Apple/Mozilla/Microsoft) ترى نصًا مشفرًا فقط. الإشعار نص عربي RTL بزرّي «دلّني» و«على الخريطة» (أو «قصّر الجولة»)، والضغط يفتح الدليل على نفس الإجراء. على آيفون يعمل فقط بعد «إضافة إلى الشاشة الرئيسية» (iOS 16.4+)، والبطاقة تشرح ذلك. المفاتيح: `npm run push:keys`.

المكالمة الحية: `POST /api/v1/events/{slug}/assistant/call` يبني تعليمات المكالمة الشخصية ويصدر مفتاح OpenAI Realtime مؤقتًا (دقيقتان، `WANEES_OPENAI_REALTIME_MODEL`، افتراضيًا `gpt-realtime-2`). المتصفح يتصل عبر WebRTC (`app/lib/realtime-call.ts`). النموذج الصوتي لا يعرف حقائق الفعالية بنفسه: كل حقيقة أو تعديل يمر بالأداة `ask_wanees_engine` التي تستدعي `/assistant` بـ`channel: "call"`، و`respond_to_proposal` لا تُستدعى إلا بعد موافقة الزائر الصريحة بالصوت. إذا تعذرت المكالمة الحية ترجع الواجهة لمكالمة المتصفح (`SpeechRecognition` + `speechSynthesis`). لا نحفظ الصوت؛ نص الطلبات المنقّح فقط يمر بنفس احتفاظ 24 ساعة.

### المواقع والمسارات

الخدمات والمعالم هي `RouteNode` موسّعة: `type`, `label`, `description`, `aliases`, `x`, `y`, `accessible`, `status`, وربط اختياري بمنطقة. `RouteEdge` هو مصدر المشي؛ يستخدم `Site.shortestPathWalkMin` أقصر مسار للحواف المفتوحة، مع fallback تقريبي إذا لم تتوفر شبكة قابلة للوصول. لا تضف Service model منفصلًا ما لم يتغير القرار المعماري.

تختار واجهة بوليفارد وورلد أقرب عقدة مفتوحة على الجهاز بعد إذن الموقع. واجهة الاتجاهات ترسل معرّف العقدة ومعرّف الوجهة. تبقى الإحداثيات الدقيقة على الجهاز أثناء التوجيه، وتظل نقطة البداية اليدوية متاحة. OpenAI يستقبل النص المنقّح عبر `app/lib/llm.ts`، والناتج المقرر للمسار والاتجاهات يبقى حتميًا من الكتالوج.

### الخصوصية

الجلسة مجهولة ومقيدة بفعالية ونسخة catalog. `ConversationTurn` redacted و24 ساعة، و`assistantContext` IDs فقط و24 ساعة. لا تضف اسمًا أو هاتفًا أو transcript دائمًا. لا تضع secrets أو `.env` في GitHub.
المتصفح يستخدم cookie باسم `wanees_visitor_session` مع `HttpOnly` و`SameSite=Lax`؛ لا تعيد تخزين token أو raw chat في `localStorage`. Bearer يبقى للتطبيق الأصلي لاحقًا. مسارات session/assistant/itinerary/replan/analytics مقيدة بمعدل طلبات.

### التشغيل المرحلي

الـ flags الحالية هي `WANEES_FEATURE_BROWSER_COOKIE_SESSION`, `WANEES_FEATURE_PROPOSAL_CONCURRENCY`, `WANEES_FEATURE_MAP_2D_V2`, `WANEES_FEATURE_LLM_ADAPTER`, و`WANEES_FEATURE_RETENTION_JOB`. القيمة الافتراضية آمنة ومفعلة للديمو، ويمكن إيقاف السلوك الجديد من البيئة دون تعديل الكود. استثناء: `WANEES_FEATURE_PROPOSAL_CONCURRENCY` لم يعد يغيّر أي سلوك؛ فحص المراجعة الأساسية والحالية عند `accept` يعمل دائمًا، والعلم يظهر فقط كـ`proposalConcurrency` في الأعلام العامة.

### الفعاليات والتحديثات التشغيلية

يعيد `GET /api/events/:eventSlug` اسم الفعالية والكتالوج وأعلام الخصائص العامة. خيارات المزاج والاهتمامات ونقطة البداية الاختيارية تأتي من الكتالوج المحدد. لا تضف stable keys خاصة ببوليفارد وورلد إلى تدفق الزائر العام. يتبع عرض الخريطة `meta.features.map2dV2`، ويظل ملخص مناطق المسار ظاهرًا إذا أوقف العلم.

- `GET /api/v1/events/:eventSlug/updates?view=active|history` يتطلب دورًا منظميًا مصرحًا.
- `PATCH /api/v1/events/:eventSlug/updates/:updateId` يستقبل `{ "action": "revoke", "reason": "optional text" }`؛ يسجل المنفذ والوقت والسبب الاختياري ويحفظ `AuditLog`.
- الإلغاء غير هدّام ومحصور بالفعالية ومحمّي من CSRF ومحدد المعدل ومتكرر بأمان. اللقطة المرتبطة بالتحديث المسحوب لا تدخل في الحالة الحية أو إعادة التخطيط.

نسخ قاعدة البيانات ينفذ عبر `npm run db:backup` باستخدام AES-256-GCM واحتفاظ افتراضي سبعة أيام. تمرين الاستعادة `npm run db:restore-smoke` يستعمل قاعدة مؤقتة منفصلة ثم يحذفها. النسخ المحلية على الـ VPS لا تحمي من فقدان الـ VPS؛ احتفظ بنسخة مشفرة خارج الجهاز للتعافي من الكوارث.

الـ health endpoints عامة ومنقحة وتعيد `503` إذا غابت PostgreSQL أو تعذرت. المراقبة الاختيارية عبر `WANEES_ERROR_MONITORING_DSN` خادمية فقط؛ قبل الإرسال تحذف الطلب والمستخدم والـ extras والـ breadcrumbs والـ tags ورسالة الاستثناء، وتحتفظ بإطارات المكدس فقط.

## مسار العمل بين المحلي وGitHub وVPS

- طوّر واختبر في نسخة عمل منفصلة عن الإصدار الجاري على الـVPS، ثم احفظ التغييرات في GitHub عبر طلب دمج.
- GitHub هو مصدر الكود. انشر commit معتمدًا ومتحققًا منه من `origin/main` فقط، وفق [دليل Hetzner](../deploy/hetzner/README.md).
- قبل البدء أو الدفع أو النشر: نفّذ fetch، وافحص الحالة والاختلاف مع upstream، ولا تكتب فوق عمل وكيل آخر أو تستخدم force-push على `main`.
- ملفات `.env.local` والأسرار وقاعدة البيانات المحلية لا تنتقل عبر GitHub. يجب تجهيز أسرار الـVPS بشكل منفصل ومن دون طباعتها أو توثيق قيمها.

## طريقة العمل

1. عدّل schema ثم migration ثم seed قبل استخدام حقل جديد.
2. نفّذ domain logic واختباره قبل ربط الشاشة.
3. حدّث API contract عند تغيير response.
4. شغّل `npm run db:format`, `npm run db:validate`, `npm run db:generate`.
5. شغّل `npm test` داخل `app/`، واختبارات `admin/`، و`tsc --noEmit`، ثم builds.
6. افحص `git diff --check`، حدّث الوثيقة المناسبة، ثم commit/push وراقب CI.
7. إذا تغيرت عقود الجلسة أو الاقتراحات، شغّل `npm run db:smoke` في PostgreSQL و`npm run test:http` بعد تشغيل التطبيق.

## تحقق سريع

```powershell
npm run db:validate
npm run db:generate
npm test --prefix app
npm test --prefix admin
npx tsc --noEmit --prefix app
npx tsc --noEmit --prefix admin
npm run build --prefix app
npm run build --prefix admin
npm run db:smoke
npm run test:http
```

لا تستخدم `git reset --hard` أو تحذف بيانات قاعدة البيانات. إذا احتجت اختبارًا حقيقيًا للهجرة، شغّل PostgreSQL منفصلًا ثم `npm run db:deploy` و`npm run db:seed`.
