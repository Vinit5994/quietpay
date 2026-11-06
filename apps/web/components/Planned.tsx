/** Placeholder for pages that later tasks fill in. Remove once every route is built. */
export function Planned({ title, task, children }: { title: string; task: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">QuietPay · {task}</p>
      <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-[var(--color-muted)]">This page is built in task {task}.</p>
      {children}
    </main>
  );
}
