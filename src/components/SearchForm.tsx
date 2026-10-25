export default function SearchForm({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <form action="/cari" role="search" className="flex w-full items-center rounded-full border-2 border-brand/30 bg-surface pl-5 shadow-sm focus-within:border-brand">
      <input name="q" defaultValue={defaultValue} type="search" placeholder="Cari berita" aria-label="Cari berita" className="min-w-0 flex-1 bg-transparent py-2.5 text-[0.95rem] outline-none placeholder:text-muted" />
      <button className="m-1 grid h-9 w-9 place-items-center rounded-full bg-brand text-bg hover:brightness-110" aria-label="Cari">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </button>
    </form>
  );
}
