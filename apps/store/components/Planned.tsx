/** Placeholder for pages that later tasks fill in. */
export function Planned({ title, task }: { title: string; task: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 opacity-70">Built in task {task}.</p>
    </main>
  );
}
