export type Article = {
  id: number; slug: string; title: string; ai_summary: string; category: string; tags: string[];
  image_url: string | null; image_credit: string | null; source_name: string; published_at: string;
  source_url?: string; original_title?: string; key_points?: string[]; meta_title?: string | null; meta_description?: string | null;
};
export type Source = {
  id: number; name: string; type: 'rss' | 'scrape'; url: string;
  selectors: { link?: string; article?: string }; active: boolean; last_fetched_at: string | null;
};

export type Platform = 'google' | 'x' | 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'threads';
export type Trend = { id: number; platform: Platform; kind: 'topic' | 'post'; rank: number; title: string; url: string | null; metric: string | null; image_url: string | null };
export type TrendRow = Omit<Trend, 'id'>;
export const PLATFORM_LABEL: Record<Platform, string> = { google: 'Google Trends', x: 'X', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads' };
