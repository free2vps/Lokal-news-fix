import type { Article } from './types';

// A mixed page can contain just six news items when entertainment is empty.
// Only an empty response proves that the next page has no more items.
export function feedIsExhausted(items: readonly unknown[]) { return items.length === 0; }
export function appendUniqueArticles(current: Article[], incoming: Article[], initialIds: number[] = []) {
  const hidden = new Set(initialIds);
  return [...new Map([...current, ...incoming].filter(a => !hidden.has(a.id)).map(a => [a.id, a])).values()];
}
export function validFeedResponse(value: unknown): value is Article[] {
  return Array.isArray(value) && value.every(a => a && Number.isFinite(a.id) &&
    ['slug', 'title', 'category', 'source_name', 'published_at'].every(k => typeof a[k] === 'string'));
}
