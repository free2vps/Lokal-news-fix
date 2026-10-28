import type { Metadata } from 'next';
import './hub.css';
export const metadata: Metadata = { title: 'Content Hub', robots: { index: false, follow: false } };
export default function HubLayout({ children }: { children: React.ReactNode }) {
  return <html lang="id"><body className="hub-body">{children}</body></html>;
}
