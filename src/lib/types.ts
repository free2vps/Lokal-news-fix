export type Article = {
  id: number; slug: string; title: string; ai_summary: string; category: string; tags: string[];
  image_url: string | null; image_credit: string | null; source_name: string; published_at: string;
  section?: Section; region?: string | null; image_width?: number | null; image_height?: number | null; social_caption?: string | null; section_headings?: string[]; source_url?: string; original_title?: string; key_points?: string[]; meta_title?: string | null; meta_description?: string | null;
};
export type Section = 'berita' | 'hiburan';
export type Source = {
  id: number; name: string; type: 'rss' | 'scrape'; url: string;
  selectors: { link?: string; article?: string }; section: Section; active: boolean; last_fetched_at: string | null;
};

export type Platform = 'google' | 'x' | 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'threads' | 'x_t24' | 'yt_t24' | 'yt_feed';
export type Trend = { id: number; platform: Platform; kind: 'topic' | 'post' | 'video'; rank: number; title: string; url: string | null; metric: string | null; image_url: string | null };
export type TrendRow = Omit<Trend, 'id'>;
export const PLATFORM_LABEL: Record<Platform, string> = { google: 'Google Trends', x: 'X', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads', x_t24: 'X', yt_t24: 'YouTube Trending', yt_feed: 'YouTube' };
