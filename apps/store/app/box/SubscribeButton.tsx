"use client";

import { useState, useTransition } from "react";
import { subscribeToBox } from "./actions";

export function SubscribeButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await subscribeToBox();
            if (res?.error) setError(res.error);
          })
        }
        className="h-14 w-full rounded-lg bg-[var(--color-primary)] px-8 text-lg font-semibold text-white transition hover:bg-[var(--color-primary-hover)] disabled:opacity-70 sm:w-auto"
      >
        {pending ? "Starting checkout…" : label}
      </button>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
