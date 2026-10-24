'use client';
export default function ThemeToggle() {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
  };
  return (
    <button onClick={toggle} aria-label="Ganti mode terang/gelap" className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink hover:bg-line/50">
      <svg className="hidden dark:block" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      <svg className="dark:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
    </button>
  );
}
