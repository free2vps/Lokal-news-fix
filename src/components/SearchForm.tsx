export default function SearchForm({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <form action="/cari" role="search" className="flex w-full items-center rounded-full border border-line bg-surface pl-4 focus-within:border-brand">
      <input name="q" defaultValue={defaultValue} type="search" placeholder="Cari berita" aria-label="Cari berita" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted" />
      <button className="grid h-9 w-9 place-items-center text-muted hover:text-brand" aria-label="Cari">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </button>
    </form>
  );
}
