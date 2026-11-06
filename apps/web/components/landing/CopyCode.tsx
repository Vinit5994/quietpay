"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** One-line command with a copy button. */
export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[#06261d] py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 select-all truncate font-mono text-xs text-[#e6f0ec]" translate="no">
        {code}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? "Copied" : `Copy ${code}`}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-[#7ee2b8]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
