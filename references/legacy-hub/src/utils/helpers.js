const crypto = require('crypto');

function generateId() {
  return crypto.randomUUID();
}

function nowISO() {
  return new Date().toISOString();
}

// Normalisasi tanggal ke ISO 8601 UTC
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch (e) {
    return null;
  }
}

// Bersihkan HTML tags dari teks
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Potong teks ke batas karakter tanpa memotong kata tengah
function truncateText(text, maxChars) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const cut = text.substring(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.7) {
    return cut.substring(0, lastSpace).trim() + '…';
  }
  return cut.trim() + '…';
}

// Ekstrak kalimat dari teks
function extractSentences(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// Buat fingerprint deduplikasi dari judul + sumber + tanggal
function createDedupKey(title, sourceName, publishedAt) {
  const raw = `${title.toLowerCase().trim()}|${sourceName.toLowerCase().trim()}|${publishedAt || ''}`;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

// Normalisasi teks tren X (hashtag, case, spasi)
function normalizeTrendText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/#/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Validasi URL gambar - bukan logo Google, favicon, placeholder
function isValidImageUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const hostname = u.hostname.toLowerCase();
    const pathname = u.pathname.toLowerCase();
    
    // Block logo Google
    if (hostname.includes('google.com') || hostname.includes('gstatic.com')) {
      if (pathname.includes('logo') || pathname.includes('favicon')) return false;
    }
    
    // Block favicon
    if (pathname.includes('favicon')) return false;
    
    // Block generic placeholders
    const placeholderPatterns = [
      'placeholder', 'dummy', 'no-image', 'noimage', 'default-image',
      'generic', 'blank', 'empty', 'missing'
    ];
    const full = (hostname + pathname).toLowerCase();
    for (const p of placeholderPatterns) {
      if (full.includes(p)) return false;
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { generateId, nowISO, normalizeDate, stripHtml, truncateText, extractSentences, createDedupKey, normalizeTrendText, isValidImageUrl };
