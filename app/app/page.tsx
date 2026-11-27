import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo, Mascot } from "@/components/Brand";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "ونيس | المرشد الذكي لزوار الفعاليات",
  description: "تعرّف على ونيس وجرّب كيف يخطّط لجولتك في بوليفارد وورلد، من تفضيلاتك إلى المسار والبدائل أثناء الزيارة.",
};

const steps = [
  {
    title: "قل له وش يناسبك",
    description: "بدون استبيان: اكتب أو تكلّم بجملة وحدة، مين معك ووش تحبون وكم عندكم وقت، ونيس يفهمك ويرتّب جولتك على طول.",
  },
  {
    title: "شوف مسارك على الخريطة",
    description: "ونيس يرتّب لك محطات من كتالوج الفعالية، مع أوقاتها والتنقّل بينها.",
  },
  {
    title: "اختَر إذا تغيّرت الظروف",
    description: "إذا زاد الزحام أو تأخّر نشاط، يقترح ونيس بديلًا ويشرح السبب. تقدر تقبل الاقتراح أو تبقي مسارك.",
  },
];

function Arrow({ direction = "←" }: { direction?: "←" | "↓" | "↗" }) {
  return <span className={styles.arrow} aria-hidden="true">{direction}</span>;
}

// Real 2026 season activities at times on their actual schedule; prices are per person.
const exampleStops = [
  { time: "18:05", name: "سكاي لوب", details: "5 د · بوليفارد بير", price: "40" },
  { time: "18:30", name: "عرض الدولفيناريوم", details: "40 د · منطقة الكوكب", price: "65" },
  { time: "19:25", name: "تجربة الزرافات", details: "20 د · منطقة أفريقيا", price: "50" },
];

// The visit starts with one sentence, not a questionnaire (app/app/demo/page.tsx, the opening composer).
const exampleChips = ["معي عيالي", "طلعة شباب", "عندي ساعتين بس"];

function ExperiencePreviews() {
  return (
    <section id="demo" className={styles.experience} aria-labelledby="demo-title">
      <div className={styles.wide}>
        <div className={styles.experienceIntro}>
          <p className={styles.kicker}>من نسخة العرض</p>
          <h2 id="demo-title">هذي تجربة ونيس.<br /><span>من أول جملة إلى آخر محطة.</span></h2>
          <p>شوف كيف تقول لونيس وش بالك، وتستعرض مسارك، وتراجع اقتراح التغيير. الزحام في المعاينة محاكاة.</p>
        </div>
        <div className={styles.screenGrid}>
          <figure className={`${styles.screenCard} ${styles.screenMain}`}>
            <div className={styles.screenFrame} aria-hidden="true">
              <div className={styles.phoneScreen}>
                <div className={styles.phoneStatus}><b>17:58</b><span>ونيس · مسارك الليلة</span></div>
                <div className={styles.miniBrand}><BrandLogo height={24} label="" /><span>مسار توضيحي</span></div>
                <p className={styles.miniTitle}>مسارك جاهز · 3 محطات · 155 ريال للشخص</p>
                <div className={styles.miniStops}>
                  {exampleStops.map((stop) => (
                    <div className={styles.miniStop} key={stop.name}>
                      <time dateTime={stop.time} dir="ltr">{stop.time}</time>
                      <div><b>{stop.name}</b><small>{stop.details}</small></div>
                      <span className={styles.miniPrice}>{stop.price}</span>
                    </div>
                  ))}
                </div>
                <div className={styles.miniMap} />
                <span className={styles.miniCta}>ليش هذا المسار؟</span>
              </div>
            </div>
            <figcaption><b>مسار واضح من أول نظرة</b><small>أوقات وتذاكر ومشي بين المناطق</small></figcaption>
          </figure>

          <figure className={styles.screenCard}>
            <div className={styles.screenFrame} aria-hidden="true">
              <div className={styles.phoneScreen}>
                <div className={styles.phoneStatus}><b>17:52</b><span>قل لي وش بالك</span></div>
                <div className={styles.miniBrand}><BrandLogo height={24} label="" /></div>
                <p className={styles.miniBubble}>معي زوجتي وولدي عمره 6 ويحب الطيارات، عندنا ساعتين</p>
                <p className={styles.miniReply}>أبشر! رتبت لكم 3 محطات تناسب ولدكم، أولها ركوب الطيارات 18:05.</p>
                <div className={styles.miniChips}>{exampleChips.map((chip) => <span key={chip}>{chip}</span>)}</div>
                <span className={styles.miniCta}>يلا</span>
              </div>
            </div>
            <figcaption><b>بدون استبيان: تكلّم وبس</b><small>جملة وحدة تكفي، ونيس يفهم ويرتّب</small></figcaption>
          </figure>

          <figure className={styles.screenCard}>
            <div className={styles.screenFrame} aria-hidden="true">
              <div className={styles.phoneScreen}>
                <div className={styles.phoneStatus}><b>19:10</b><span>تحديث تجريبي</span></div>
                <div className={styles.miniAlert}>
                  <b>⚠ زحام عالٍ في منطقة أفريقيا</b>
                  <p>نقترح تأجيل تجربة الزرافات إلى 19:45 لين يخف الزحام، وباقي مسارك كما هو.</p>
                  <div className={styles.miniActions}><span className={styles.miniCta}>اعتمد البديل</span><span>أبقي مساري</span></div>
                </div>
                <p className={styles.miniTitle}>مسارك يتكيّف مع الزحام</p>
                <p className={styles.miniSub}>شوف سبب البديل وقرّر إذا يناسبك.</p>
                <div className={styles.miniMap} />
              </div>
            </div>
            <figcaption><b>تغيير مفهوم مع سبب واضح</b><small>تقبل البديل أو تبقي على مسارك</small></figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

// What an organizer runs from the organizer app; each line is in README.md «للمنظّمين».
const organizerFeatures = [
  { title: "انشر زحامًا أو تأخيرًا", description: "التحديث يوصل لكل زائر متأثر كاقتراح بسبب واضح، والقرار له. والإغلاق يُطبّق على المسار مباشرة." },
  { title: "طابور طلبات المساعدة", description: "طلبات الزوار من المساعد توصلك في قائمة وحدة، وبلاغات الطفل التائه أولها." },
  { title: "كتالوج بإصدارات", description: "مسودة ثم مراجعة ثم نشر، وتقدر تتراجع. والزائر يكمل على النسخة اللي بدأ فيها." },
  { title: "تحليلات بلا هوية الزائر", description: "مؤشرات تشغيل مجمّعة بدون معرّفات جلسات." },
];

/** The organizer app's public URL (set at build time, see .env.example); hidden when unset or not http(s). */
function organizerAppUrl() {
  const raw = process.env.ADMIN_APP_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function OrganizerSection() {
  const adminUrl = organizerAppUrl();
  return (
    <section id="organizers" className={`${styles.container} ${styles.organizers}`} aria-labelledby="organizers-title">
      <div className={styles.storyIntro}>
        <p className={styles.kicker}>للمنظّمين</p>
        <h2 id="organizers-title">لوحة تشغيل لفعاليتك</h2>
        <p>ونيس يرتّب جولة الزائر، وأنت تدير الفعالية من تطبيق المنظّم وقت التشغيل.</p>
      </div>
      <ul className={styles.organizerList}>
        {organizerFeatures.map(({ title, description }) => (
          <li key={title}>
            <h3>{title}</h3>
            <p>{description}</p>
          </li>
        ))}
      </ul>
      <div className={styles.organizerActions}>
        <Link className={styles.primary} href="/ops">شوف لوحة المشغّل <Arrow /></Link>
        {adminUrl && <a className={styles.secondary} href={adminUrl}>تطبيق المنظّم <Arrow direction="↗" /></a>}
      </div>
      <p className={styles.organizerNote}>لوحة المشغّل هنا عرض تجريبي للقراءة فقط، وأرقامها محاكاة.</p>
    </section>
  );
}

function ClosingPanel() {
  return (
    <section className={`${styles.wide} ${styles.closing}`} aria-labelledby="closing-title">
      <span className={styles.closingMark} aria-hidden="true" />
      <div className={styles.closingCopy}>
        <BrandLogo height={64} variant="white" wordmark label="" className={styles.closingLogo} />
        <p className={styles.kicker}>الليلة تبدأ بسؤال</p>
        <h2 id="closing-title">خلّ ونيس يجهّز<br />جولتك في بوليفارد وورلد.</h2>
        <p>بدون استبيان: جملة وحدة، ومسار ليلتك جاهز. جرّب ونيس بنفسك.</p>
        <Link className={styles.closingButton} href="/e/boulevard-world-demo">ابدأ جولتك الآن <Arrow /></Link>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div className={styles.home}>
      <a href="#main-content" className={styles.skip}>تخطَّ إلى المحتوى</a>
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerInner}`}>
          <a href="#main-content" className={styles.brand} aria-label="ونيس، الرئيسية">
            <BrandLogo height={46} label="" priority />
          </a>
          <nav className={styles.nav} aria-label="أقسام المشروع">
            <a href="#how">كيف يعمل</a>
            <a href="#demo">شاهد التجربة</a>
            <a href="#organizers">للمنظّمين</a>
            <a href="#project">عن المشروع</a>
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className={`${styles.container} ${styles.hero}`} aria-labelledby="home-title">
          <div className={styles.heroCopy}>
            <p className={styles.slogan}>الونيس اللي بيونسك</p>
            <h1 id="home-title"><span>ونيس،</span> المرشد الذكي لزوار الفعاليات</h1>
            <p>في الفعاليات الكبيرة، يساعدك ونيس تختار وش تسوي ووين تروح، ويرتّب لك جولة تناسب وقتك وميزانيتك واهتماماتك.</p>
            <div className={styles.heroActions}>
              <Link className={styles.primary} href="/e/boulevard-world-demo">جرّب ونيس <Arrow /></Link>
              <a className={styles.secondary} href="#how">كيف يعمل <Arrow direction="↓" /></a>
            </div>
          </div>
          <figure className={styles.heroArt}>
            <div className={styles.heroStage}>
              <BrandLogo height={72} wordmark label="" className={styles.heroLogo} />
              <Mascot mood="wave" height={330} alt="تميمة ونيس: روبوت أبيض وبنفسجي يلوّح بالترحيب" priority className={styles.heroMascot} />
            </div>
            <figcaption>بوليفارد وورلد <span>رفيقك في الجولة</span></figcaption>
          </figure>
        </section>

        <section id="how" className={`${styles.container} ${styles.story}`} aria-labelledby="how-title">
          <div className={styles.storyIntro}>
            <h2 id="how-title">من الحيرة إلى جولة واضحة</h2>
            <p>في بوليفارد وورلد، الأنشطة موزّعة على مناطق كثيرة والوقت محدود. هذي طريقة ونيس في ترتيب الجولة والتعامل مع تغيّرها.</p>
          </div>
          <ol className={styles.steps}>
            {steps.map(({ title, description }) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </section>

        <ExperiencePreviews />
        <OrganizerSection />
        <ClosingPanel />
      </main>

      <footer id="project" className={styles.footer} aria-label="عن المشروع">
        <div className={styles.wide}>
          <div className={styles.footerInner}>
            <a href="#main-content" className={styles.footerBrand} aria-label="ونيس، الرئيسية">
              <BrandLogo height={48} wordmark label="" />
            </a>
            <p>المرشد الذكي لزوار الفعاليات والمواسم<br />الأسعار والأوقات من كتالوج الفعالية المنشور، والزحام في المعاينة محاكاة.</p>
            <a href="https://github.com/abc7pq/wanees_platform" className={styles.repoLink}>مستودع المشروع <Arrow direction="↗" /></a>
          </div>
          <div className={styles.footerBottom}>
            <span>© ونيس <bdi>WANEES</bdi></span>
            <Link href="/e/boulevard-world-demo">الديمو الحي <Arrow /></Link>
            <Link href="/ops">عرض لوحة المشغّل <Arrow /></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
