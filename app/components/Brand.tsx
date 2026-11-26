import Image from "next/image";
import logo from "../public/brand/logo.webp";
import logoWhite from "../public/brand/logo-white.webp";
import mascotIdle from "../public/brand/mascot-idle.webp";
import mascotWave from "../public/brand/mascot-wave.webp";
import mascotWink from "../public/brand/mascot-wink.webp";
import mascotCheer from "../public/brand/mascot-cheer.webp";
import mascotTrophy from "../public/brand/mascot-trophy.webp";
import mascotConfused from "../public/brand/mascot-confused.webp";
import styles from "./brand.module.css";

/**
 * Identity-guide logo: the colour mark (or the white version on the dark brand background),
 * optionally with the letter-spaced WANEES wordmark set in Inter underneath, as in the guide.
 * `height` sets `--logo-h` (the mark's rendered height); pages may override that variable, and the wordmark scales with it.
 */
export function BrandLogo({ height = 40, variant = "color", wordmark = false, label = "ونيس", priority = false, className = "" }: {
  height?: number;
  variant?: "color" | "white";
  wordmark?: boolean;
  label?: string;
  priority?: boolean;
  className?: string;
}) {
  const src = variant === "white" ? logoWhite : logo;
  const width = Math.round((height * src.width) / src.height);
  return (
    <span className={`${styles.logo} ${variant === "white" ? styles.onDark : ""} ${className}`} style={{ "--logo-h": `${height}px` } as React.CSSProperties}>
      <Image src={src} alt={label} width={width} height={height} priority={priority} sizes={`${width * 2}px`} />
      {wordmark && <span className={styles.wordmark} aria-hidden="true">WANEES</span>}
    </span>
  );
}

const MASCOTS = { idle: mascotIdle, wave: mascotWave, wink: mascotWink, cheer: mascotCheer, trophy: mascotTrophy, confused: mascotConfused } as const;
export type MascotMood = keyof typeof MASCOTS;

/** The WANEES robot in one of its guide poses. Decorative unless `alt` is given. */
export function Mascot({ mood = "wave", height = 160, alt = "", priority = false, className = "" }: {
  mood?: MascotMood;
  height?: number;
  alt?: string;
  priority?: boolean;
  className?: string;
}) {
  const src = MASCOTS[mood];
  const width = Math.round((height * src.width) / src.height);
  return <Image className={`${styles.mascot} ${className}`} src={src} alt={alt} aria-hidden={alt ? undefined : true} width={width} height={height} priority={priority} sizes={`${width}px`} />;
}
