import { PLATFORM_LABEL, type Trend } from '@/lib/types';

export default function SocialHype({ items }: { items: Trend[] }) {
  const posts = items.filter((t) => t.kind === 'post').slice(0, 8);
  if (!posts.length) return null;
  return (
    <section aria-labelledby="hype" className="rounded-xl border border-line bg-surface p-4">
      <h2 id="hype" className="mb-1 font-serif text-xl font-semibold">Lagi hype di sosial</h2>
      <p className="mb-2 text-xs text-muted">Tautan membuka platform aslinya di tab baru.</p>
      <ul className="divide-y divide-line">
        {posts.map((p) => (
          <li key={p.id}>
            <a href={p.url || '#'} target="_blank" rel="nofollow noopener" className="flex gap-3 py-3 hover:text-brand">
              {p.image_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-14 w-20 shrink-0 rounded-md bg-line/50 object-cover" />}
              <span className="min-w-0">
                <span className="line-clamp-2 text-sm font-medium leading-snug">{p.title}</span>
                <span className="mt-1 inline-flex items-center gap-2 text-xs text-muted">
                  <span className="rounded-full border border-line px-2 py-px">{PLATFORM_LABEL[p.platform]}</span>{p.metric}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
