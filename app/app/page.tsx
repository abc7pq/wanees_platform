import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo, Mascot } from "@/components/Brand";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "ونيس | مشروع المرشد الذكي للفعاليات",
  description: "تعرّف على مشروع ونيس وجرّب كيف يخطّط لجولتك في بوليفارد وورلد، من تفضيلاتك إلى المسار والبدائل أثناء الزيارة.",
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

const exampleStops = [
  { time: "18:08", name: "سكاي لوب", details: "١٠ د · منصة المغامرة", price: "٥٠" },
  { time: "18:31", name: "فندق الفامباير", details: "٣٠ د · ١٣ د مشي", price: "٤٥" },
  { time: "19:05", name: "نقمة النيل", details: "٣٠ د · منطقة الاكتشاف", price: "٤٥" },
];

// Identity-guide line icons (rounded stroke) instead of emoji.
const MINI_ICONS: Record<string, React.ReactNode> = {
  bolt: <path d="m13 2-3 9h7l-8 11 2-9H6l7-11Z" />,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  ticket: <><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8Z" /><path d="M13 6v2m0 3v2m0 3v2" /></>,
  family: <><circle cx="7" cy="6" r="2.5" /><circle cx="17" cy="6" r="2.5" /><circle cx="12" cy="13" r="2" /><path d="M3 21v-4a4 4 0 0 1 4-4m14 8v-4a4 4 0 0 0-4-4M9 21v-1.5a3 3 0 0 1 6 0V21" /></>,
};
function MiniIcon({ name }: { name: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{MINI_ICONS[name]}</svg>;
}

const exampleMoods = [
  { icon: "bolt", label: "مغامرات" },
  { icon: "moon", label: "هدوء" },
  { icon: "ticket", label: "عروض" },
  { icon: "family", label: "عائلة" },
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
                <div className={styles.phoneStatus}><b>٩:٤١</b><span>ونيس · مسارك الليلة</span></div>
                <div className={styles.miniBrand}><BrandLogo height={24} label="" /><span>مسار توضيحي</span></div>
                <p className={styles.miniTitle}>مسارك جاهز · ٦ محطات · ٢٧٥ ريال</p>
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
                <div className={styles.phoneStatus}><b>٩:٣٨</b><span>سؤال ٢ من ٥</span></div>
                <div className={styles.miniBrand}><BrandLogo height={24} label="" /></div>
                <p className={styles.miniTitle}>وش مزاجك الليلة؟</p>
                <div className={styles.miniTiles}>
                  {exampleMoods.map(({ icon, label }) => <div key={label}><span><MiniIcon name={icon} /></span><b>{label}</b></div>)}
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
                <div className={styles.phoneStatus}><b>٩:٥٢</b><span>تحديث تجريبي</span></div>
                <div className={styles.miniAlert}>
                  <b>⚠ زحام شديد في منطقة أفريقيا</b>
                  <p>نقترح تبديل محطتك القادمة إلى سكاي لوب، أقل ازدحامًا و٤ دقائق أقرب.</p>
                  <div className={styles.miniActions}><span className={styles.miniCta}>بدّل</span><span>ليس الآن</span></div>
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
        <ClosingPanel />
      </main>

      <footer id="project" className={styles.footer} aria-label="عن المشروع">
        <div className={styles.wide}>
          <div className={styles.footerInner}>
            <a href="#main-content" className={styles.footerBrand} aria-label="ونيس، الرئيسية">
              <BrandLogo height={48} wordmark label="" />
            </a>
            <p>حل تحدي «خدمة المرشد الشخصي الذكي التفاعلي»<br />هاكاثون <bdi>agentX</bdi> الرابع · شريك التحدي الهيئة العامة للترفيه <bdi>(GEA)</bdi></p>
            <a href="https://github.com/abc7pq/wanees" className={styles.repoLink}>مستودع المشروع <Arrow direction="↗" /></a>
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
