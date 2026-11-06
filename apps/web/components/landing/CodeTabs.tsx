"use client";

import { useState } from "react";

export type CodeTab = { id: string; file: string; code: string };

/** Tabbed, copyable code panel with light syntax colouring (no dependencies). */
export function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  const [active, setActive] = useState(tabs[0]!.id);
  const [copied, setCopied] = useState(false);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]!;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tab.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the code is selectable */
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#26262b] bg-[#111113] shadow-[var(--shadow-pop)]">
      <div className="flex items-center justify-between gap-3 border-b border-[#26262b] px-2">
        <div role="tablist" aria-label="Integration code" className="flex overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === active}
              onClick={() => setActive(t.id)}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 font-mono text-xs transition-colors ${
                t.id === active ? "border-[#34d399] text-white" : "border-transparent text-[#8b8b93] hover:text-white"
              }`}
            >
              {t.file}
            </button>
          ))}
        </div>
        <button type="button" onClick={copy} className="shrink-0 rounded-md px-2 py-1 text-xs text-[#8b8b93] hover:bg-white/5 hover:text-white">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-[#e4e4e7]" role="tabpanel">
        <code>{highlight(tab.code)}</code>
      </pre>
    </div>
  );
}

const TOKEN = /(\/\/[^\n]*)|(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*")|\b(import|from|export|async|function|const|await|return|if|new)\b/g;

function highlight(code: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(code.slice(last, i));
    const cls = m[1] ? "text-[#6b6b74]" : m[2] ? "text-[#86efac]" : "text-[#c4b5fd]";
    out.push(
      <span key={i} className={cls}>
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}
