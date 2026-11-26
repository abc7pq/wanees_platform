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
    description: "جاوب عن أسئلة قصيرة عن وقتك وميزانيتك واهتماماتك ومين معك.",
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

// Identity-guide line icons (rounded stroke) instead of emoji.
const MINI_ICONS: Record<string, React.ReactNode> = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />,
  people: <><circle cx="9" cy="8" r="3.5" /><circle cx="17" cy="9" r="2.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M15 14.5a5 5 0 0 1 6.5 5.5" /></>,
  family: <><circle cx="7" cy="6" r="2.5" /><circle cx="17" cy="6" r="2.5" /><circle cx="12" cy="13" r="2" /><path d="M3 21v-4a4 4 0 0 1 4-4m14 8v-4a4 4 0 0 0-4-4M9 21v-1.5a3 3 0 0 1 6 0V21" /></>,
};
function MiniIcon({ name }: { name: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{MINI_ICONS[name]}</svg>;
}

// The app's real first question and its options (app/app/demo/page.tsx).
const exampleCompanions = [
  { icon: "user", label: "لحالي" },
  { icon: "heart", label: "شريكي" },
  { icon: "family", label: "عائلة وأطفال" },
  { icon: "people", label: "أصدقاء" },
];

function ExperiencePreviews() {
  return (
    <section id="demo" className={styles.experience} aria-labelledby="demo-title">
      <div className={styles.wide}>
        <div className={styles.experienceIntro}>
          <p className={styles.kicker}>من نسخة العرض</p>
          <h2 id="demo-title">هذي تجربة ونيس.<br /><span>من أول سؤال إلى آخر محطة.</span></h2>
          <p>شوف كيف تختار تفضيلاتك، وتستعرض مسارك، وتراجع اقتراح التغيير. الزحام في المعاينة محاكاة.</p>
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
                <div className={styles.phoneStatus}><b>17:52</b><span>سؤال 1 من 5</span></div>
                <div className={styles.miniBrand}><BrandLogo height={24} label="" /></div>
                <p className={styles.miniTitle}>مين معك الليلة؟</p>
                <div className={styles.miniTiles}>
                  {exampleCompanions.map(({ icon, label }) => <div key={label}><span><MiniIcon name={icon} /></span><b>{label}</b></div>)}
                </div>
                <div className={styles.miniProgress} />
                <span className={styles.miniCta}>التالي</span>
              </div>
            </div>
            <figcaption><b>خمس أسئلة وتبدأ جولتك</b><small>المسار يتشكل حسب تفضيلاتك</small></figcaption>
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
        <p>خمس أسئلة، ومسار ليلتك جاهز. جرّب ونيس بنفسك.</p>
        <Link className={styles.closingButton} href="/demo">ابدأ جولتك الآن <Arrow /></Link>
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
              <Link className={styles.primary} href="/demo">جرّب ونيس <Arrow /></Link>
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
            <Link href="/demo">الديمو الحي <Arrow /></Link>
            <Link href="/ops">عرض لوحة المشغّل <Arrow /></Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
