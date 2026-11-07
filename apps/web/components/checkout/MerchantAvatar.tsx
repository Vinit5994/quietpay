/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";

/**
 * The merchant's icon at checkout. QuietPay has no logo upload yet, so we use the icon the
 * merchant's own site already serves (`/icon.svg`, then `/favicon.ico`, from the site the customer
 * came from) and fall back to the first letter of the business name.
 */
export function MerchantAvatar({ name, siteUrl, size = 44 }: { name: string; siteUrl?: string | null; size?: number }) {
  const origin = safeOrigin(siteUrl);
  const candidates = origin ? [`${origin}/icon.svg`, `${origin}/favicon.ico`] : [];
  const [index, setIndex] = useState(0);
  const src = candidates[index];

  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-base)] border border-[var(--color-line)] bg-white font-[family-name:var(--font-display)] text-lg font-semibold shadow-[var(--shadow-card)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" width={size - 14} height={size - 14} className="object-contain" onError={() => setIndex((i) => i + 1)} />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function safeOrigin(url?: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}
