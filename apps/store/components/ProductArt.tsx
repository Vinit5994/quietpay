import type { ArtKind } from "@/lib/products";

/** Flat illustrations of our products, drawn in code (no third-party artwork). */
export function ProductArt({ kind, base, accent, className = "" }: { kind: ArtKind; base: string; accent: string; className?: string }) {
  const shade = "rgba(0,0,0,0.14)";
  const star = (x: number, y: number, s: number) => (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0-10c.8 4.6 4.4 8.2 9 9-4.6.8-8.2 4.4-9 9-.8-4.6-4.4-8.2-9-9 4.6-.8 8.2-4.4 9-9Z"
      fill={accent}
    />
  );
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label={kind}>
      {kind === "hoodie" && (
        <g>
          <path d="M72 38c6-12 50-12 56 0l32 22 14 70-22 6-6-44v84H60V92l-6 44-22-6 14-70 32-22Z" fill={base} />
          <path d="M80 40c4 20 36 20 40 0" fill="none" stroke={shade} strokeWidth="6" />
          <path d="M84 150h32l4 22H80l4-22Z" fill={shade} />
          <line x1="94" y1="58" x2="92" y2="80" stroke="#fff" strokeOpacity=".7" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="106" y1="58" x2="108" y2="80" stroke="#fff" strokeOpacity=".7" strokeWidth="2.5" strokeLinecap="round" />
          {star(120, 96, 0.9)}
        </g>
      )}
      {kind === "tee" && (
        <g>
          <path d="M70 40l18-6c4 10 20 10 24 0l18 6 34 22-14 26-20-10v92H70V78L50 88 36 62l34-22Z" fill={base} stroke="#d9d3bf" strokeWidth="2" />
          <path d="M88 34c4 12 20 12 24 0" fill="none" stroke="#d9d3bf" strokeWidth="3" />
          <text x="100" y="120" textAnchor="middle" fontSize="20" fontWeight="800" fill={accent} fontFamily="ui-sans-serif, system-ui">
            SHIP IT
          </text>
          {star(130, 92, 0.7)}
        </g>
      )}
      {kind === "cap" && (
        <g>
          <path d="M44 122c0-40 24-66 58-66s56 26 56 62l-114 4Z" fill={base} />
          <path d="M40 120c30-6 82-8 128 2 8 2 6 14-4 14-40-4-80-4-122 0-10 0-12-14-2-16Z" fill={base} />
          <path d="M40 120c30-6 82-8 128 2" fill="none" stroke={shade} strokeWidth="4" />
          <circle cx="100" cy="58" r="5" fill={shade} />
          {star(100, 96, 1.1)}
        </g>
      )}
      {kind === "stickers" && (
        <g>
          <rect x="46" y="52" width="80" height="80" rx="18" fill={accent} transform="rotate(-10 86 92)" />
          <circle cx="128" cy="118" r="38" fill={base} stroke="#fff" strokeWidth="5" />
          <rect x="52" y="112" width="56" height="40" rx="10" fill="#fff" stroke={accent} strokeWidth="4" transform="rotate(8 80 132)" />
          <text x="80" y="138" textAnchor="middle" fontSize="13" fontWeight="800" fill={accent} fontFamily="ui-sans-serif, system-ui" transform="rotate(8 80 132)">
            GM
          </text>
          <path transform="translate(86 90) scale(1.6)" d="M0-10c.8 4.6 4.4 8.2 9 9-4.6.8-8.2 4.4-9 9-.8-4.6-4.4-8.2-9-9 4.6-.8 8.2-4.4 9-9Z" fill="#fff" />
          <path transform="translate(128 118) scale(1.8)" d="M0-10c.8 4.6 4.4 8.2 9 9-4.6.8-8.2 4.4-9 9-.8-4.6-4.4-8.2-9-9 4.6-.8 8.2-4.4 9-9Z" fill={accent} />
        </g>
      )}
      {kind === "box" && (
        <g>
          <path d="M100 52l62 26v70l-62 26-62-26V78l62-26Z" fill={base} />
          <path d="M100 104l62-26v70l-62 26v-70Z" fill={shade} />
          <path d="M38 78l62 26 62-26" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2" />
          <path d="M70 65l62 26v24" fill="none" stroke={accent} strokeWidth="8" />
          {star(100, 34, 1.3)}
          {star(150, 46, 0.7)}
        </g>
      )}
    </svg>
  );
}
