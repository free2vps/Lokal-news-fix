export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="legal mx-auto max-w-3xl rounded-xl border border-line bg-surface p-6 md:p-10">
      <h1>{title}</h1>
      <p className="!text-sm !text-muted">Terakhir diperbarui: {updated}</p>
      {children}
    </article>
  );
}
