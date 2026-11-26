import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import logo from "../public/brand/logo.png";
import diorama from "../public/brand/diorama.png";
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

const exampleMoods = [
  { icon: "🎢", label: "مغامرات" },
  { icon: "🌙", label: "هدوء" },
  { icon: "🎭", label: "عروض" },
  { icon: "👨‍👩‍👧", label: "عائلة" },
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
                <div className={styles.miniBrand}><Image src={logo} alt="" width={37} height={24} /><span>مسار توضيحي</span></div>
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
                <div className={styles.miniBrand}><Image src={logo} alt="" width={37} height={24} /></div>
                <p className={styles.miniTitle}>وش مزاجك الليلة؟</p>
                <div className={styles.miniTiles}>
                  {exampleMoods.map(({ icon, label }) => <div key={label}><span>{icon}</span><b>{label}</b></div>)}
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
      <svg className={styles.closingRibbon} viewBox="0 0 300 190" fill="none" aria-hidden="true">
        <path d="M306 6C250 30 236 78 184 94S80 98 22 158M318 46C266 66 256 106 208 122S112 134 54 194" stroke="#3fd8d0" strokeWidth="3" strokeLinecap="round" />
        <path d="M312 26C258 48 246 92 196 108S96 116 38 176" stroke="#8f7be8" strokeWidth="3" strokeLinecap="round" />
        <circle cx="246" cy="58" r="5.5" fill="#feb794" />
        <circle cx="118" cy="126" r="5" fill="#6af1dd" />
      </svg>
      <span className={styles.closingMark} aria-hidden="true">و</span>
      <div className={styles.closingCopy}>
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
            <Image src={logo} alt="" width={72} height={46} />
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
            <h1 id="home-title"><span>ونيس،</span> المرشد الذكي لزوار الفعاليات</h1>
            <p>في الفعاليات الكبيرة، يساعدك ونيس تختار وش تسوي ووين تروح، ويرتّب لك جولة تناسب وقتك وميزانيتك واهتماماتك.</p>
            <div className={styles.heroActions}>
              <Link className={styles.primary} href="/demo">جرّب ونيس <Arrow /></Link>
              <a className={styles.secondary} href="#how">كيف يعمل <Arrow direction="↓" /></a>
            </div>
          </div>
          <figure className={styles.heroArt}>
            <Image
              src={diorama}
              alt="مجسّم لمرشد ونيس بجوار ممشى بين مناطق الفعالية"
              sizes="(max-width: 800px) 92vw, 560px"
              priority
            />
            <figcaption>بوليفارد وورلد <span>مجسّم توضيحي</span></figcaption>
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
              <Image src={logo} alt="" width={76} height={48} />
              <span dir="ltr">WANEES</span>
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
