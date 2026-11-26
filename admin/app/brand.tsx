import Image from "next/image";
import logo from "../public/brand/logo.webp";
import logoWhite from "../public/brand/logo-white.webp";
import mascotWave from "../public/brand/mascot-wave.webp";
import mascotConfused from "../public/brand/mascot-confused.webp";

/** Identity-guide logo lock-up (same as the visitor app): colour or white mark, optional WANEES wordmark in Inter. */
export function BrandLogo({ height = 36, variant = "color", wordmark = false, label = "ونيس", priority = false, className = "" }: {
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
    <span className={`brand-logo${variant === "white" ? " on-dark" : ""} ${className}`} style={{ "--logo-h": `${height}px` } as React.CSSProperties}>
      <Image src={src} alt={label} width={width} height={height} priority={priority} sizes={`${width * 2}px`} />
      {wordmark && <span className="brand-wordmark" aria-hidden="true">WANEES</span>}
    </span>
  );
}

const MASCOTS = { wave: mascotWave, confused: mascotConfused } as const;

/** The WANEES robot in one of its guide poses. Decorative unless `alt` is given. */
export function Mascot({ mood = "wave", height = 150, alt = "", className = "" }: { mood?: keyof typeof MASCOTS; height?: number; alt?: string; className?: string }) {
  const src = MASCOTS[mood];
  const width = Math.round((height * src.width) / src.height);
  return <Image className={`brand-mascot ${className}`} src={src} alt={alt} aria-hidden={alt ? undefined : true} width={width} height={height} sizes={`${width * 2}px`} />;
}
