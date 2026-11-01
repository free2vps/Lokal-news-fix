const Parser = require('rss-parser');
const { safeFetch: fetch } = require('../utils/network');
const { generateId, nowISO, normalizeDate, stripHtml, truncateText, extractSentences, createDedupKey, isValidImageUrl } = require('../utils/helpers');

const parser = new Parser({
  headers: {
    'User-Agent': 'PortalContentHub/1.0 (https://portal.example.com; contact@portal.example.com)'
  },
  customFields: { item: ['media:content','media:thumbnail','source'] },
  timeout: 15000
});

// Stopwords bahasa Indonesia dan Inggris
const STOPWORDS = new Set([
  // Indonesia
  'yang', 'dan', 'di', 'ke', 'dari', 'dalam', 'untuk', 'pada', 'adalah', 'ini', 'itu',
  'dengan', 'atau', 'jika', 'kita', 'mereka', 'saya', 'anda', 'dia', 'kami', 'kami',
  'bisa', 'akan', 'telah', 'sudah', 'belum', 'tidak', 'jangan', 'harus', 'perlu',
  'saat', 'kapan', 'dimana', 'mengapa', 'bagaimana', 'selama', 'sebelum', 'setelah',
  'daripada', 'terhadap', 'mengenai', 'tentang', 'antara', 'bagi', 'tanpa', 'selain',
  'demi', 'karena', 'karenanya', 'otomatis', 'secara', 'serta', 'hingga', 'sampai',
  'masih', 'lagi', 'baru', 'lama', 'besar', 'kecil', 'tinggi', 'rendah', 'baik',
  'buruk', 'benar', 'salah', 'new', 'terbaru', 'terkini',
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have',
  'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'must', 'shall', 'can', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs'
]);

// Kategori mapping berdasarkan kata kunci
const CATEGORY_KEYWORDS = {
  'Pendidikan': ['beasiswa', 'sekolah', 'kampus', 'mahasiswa', 'pendidikan', 'pelajar', 'universitas', 'kuliah', 'magang', 'kampus'],
  'Karier': ['karier', 'pekerjaan', 'lowongan kerja', 'fresh graduate', 'magang', 'kerja', 'karir', 'loker'],
  'Ekonomi dan Bisnis': ['ekonomi', 'bisnis', 'wirausaha', 'startup', 'UMKM', 'kewirausahaan', 'investasi', 'pasar'],
  'Teknologi': ['teknologi', 'AI', 'aplikasi', 'software', 'digital', 'tiktok', 'gaming', 'media sosial'],
  'Pemuda dan Komunitas': ['pemuda', 'komunitas', 'prestasi', 'inovasi', 'kreativitas', 'anak muda'],
  'Kesehatan': ['kesehatan', 'mental', 'gaya hidup', 'olahraga', 'pergaulan'],
  'Berita Lokal NTB': ['NTB', 'Nusa Tenggara Barat', 'Mataram', 'Sumbawa', 'Taliwang', 'Lombok'],
};

function determineCategory(title, description, sourceCategory, region) {
  const text = `${title || ''} ${description || ''} ${sourceCategory || ''}`.toLowerCase();
  
  // Cek lokal NTB dulu (prioritas tinggi untuk region NTB)
  if (region === 'NTB') {
    for (const kw of CATEGORY_KEYWORDS['Berita Lokal NTB']) {
      if (text.includes(kw.toLowerCase())) {
        return 'Berita Lokal NTB';
      }
    }
  }
  
  // Cek kategori lainnya berdasarkan keyword
  let bestMatch = null;
  let bestScore = 0;
  
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'Berita Lokal NTB') continue;
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = category;
    }
  }
  
  if (bestMatch && bestScore >= 2) return bestMatch;
  
  // Fallback ke kategori sumber
  return sourceCategory || 'Umum';
}

function determineAudienceSegment(title, description, category) {
  const text = `${title || ''} ${description || ''} ${category || ''}`.toLowerCase();
  
  // Bobot prioritas usia: 25-39 (50%), 15-24 (25%), 40+ (25%)
  // Keterkaitan konten dengan segmen usia
  let score25to39 = 0;
  let score15to24 = 0;
  let score40plus = 0;
  
  // 15-24: pendidikan, kampus, mahasiswa, gaming, teknologi, sosial
  const youthKeywords = ['kampus', 'mahasiswa', 'beasiswa', 'pelajar', 'gaming', 'teknologi', 'media sosial', 'pemuda', 'komunitas'];
  for (const kw of youthKeywords) {
    if (text.includes(kw)) score15to24++;
  }
  
  // 25-39: karir, pekerjaan, ekonomi, keluarga, properti, kesehatan
  const adultKeywords = ['karir', 'pekerjaan', 'ekonomi', 'bisnis', 'rumah', 'kesehatan', 'investasi', 'karier'];
  for (const kw of adultKeywords) {
    if (text.includes(kw)) score25to39++;
  }
  
  // 40+: kebijakan, pemerintahan, pensiun, sosial, agama
  const seniorKeywords = ['pemerintahan', 'kebijakan', 'pensiun', 'sosial', 'agama', 'hukum'];
  for (const kw of seniorKeywords) {
    if (text.includes(kw)) score40plus++;
  }
  
  if (score15to24 >= score25to39 && score15to24 >= score40plus && score15to24 > 0) {
    return '15-24';
  }
  if (score40plus >= score25to39 && score40plus >= score15to24 && score40plus > 0) {
    return '40+';
  }
  return '25-39'; // Default
}

function extractKeywords(title, description, sourceCategory, maxCount = 8) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  const words = text
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3)
    .filter(w => !STOPWORDS.has(w));
  
  // Hitung frekuensi kata
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }
  
  // Deteksi frasa 2 kata (bigram) yang informatif
  const wordList = words.filter(w => w.length > 3);
  const bigrams = [];
  for (let i = 0; i < wordList.length - 1; i++) {
    bigrams.push(`${wordList[i]} ${wordList[i+1]}`);
  }
  
  // Gabungkan kata tunggal dan bigram dengan skor
  const candidates = [];
  
  // Kata dari judul mendapat bonus
  const titleWords = (title || '').toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
  for (const w of titleWords) {
    candidates.push({ term: w, score: (freq[w] || 0) * 2 + 5 });
  }
  
  // Kata dari deskripsi
  for (const [term, count] of Object.entries(freq)) {
    if (!titleWords.includes(term)) {
      candidates.push({ term, score: count * 2 });
    }
  }
  
  // Bigram
  const bigramFreq = {};
  for (const b of bigrams) {
    bigramFreq[b] = (bigramFreq[b] || 0) + 1;
  }
  for (const [term, count] of Object.entries(bigramFreq)) {
    if (count >= 1) {
      candidates.push({ term, score: count * 3 });
    }
  }
  
  // Urutkan oleh skor
  candidates.sort((a, b) => b.score - a.score);
  
  // Ambil unique, batas maxCount
  const seen = new Set();
  const result = [];
  for (const c of candidates) {
    if (!seen.has(c.term)) {
      seen.add(c.term);
      result.push(c.term);
      if (result.length >= maxCount) break;
    }
  }
  
  return result;
}

// Ekstrak ringkasan ekstraktif (2-3 kalimat paling informatif)
function extractiveSummary(sourceDescription, sourceSummary, maxChars = 350) {
  const text = sourceSummary || sourceDescription || '';
  if (!text) return null;
  
  const clean = stripHtml(text);
  if (clean.length <= maxChars) return clean;
  
  const sentences = extractSentences(clean);
  if (sentences.length === 0) return truncateText(clean, maxChars);
  
  // Pilih 2-3 kalimat pertama yang cukup panjang dan informatif
  const selected = [];
  let totalLen = 0;
  
  for (const s of sentences) {
    if (s.length < 15) continue; // Skip kalimat terlalu pendek
    if (selected.length >= 3) break;
    if (totalLen + s.length > maxChars && selected.length > 0) break;
    selected.push(s);
    totalLen += s.length;
  }
  
  if (selected.length === 0) {
    return truncateText(clean, maxChars);
  }
  
  return selected.join(' ').trim();
}

// Ekstrak URL gambar dari item RSS (media:content, media:thumbnail, enclosure)
function extractImageFromItem(item) {
  // cek media:content
  if (item['media:content'] && item['media:content']['$'] && item['media:content']['$'].url) {
    return { url: item['media:content']['$'].url, source: 'media:content' };
  }
  // cek media:thumbnail
  if (item['media:thumbnail'] && item['media:thumbnail']['$'] && item['media:thumbnail']['$'].url) {
    return { url: item['media:thumbnail']['$'].url, source: 'media:thumbnail' };
  }
  // cek enclosure
  if (item.enclosure && item.enclosure['$'] && item.enclosure['$'].url) {
    const type = (item.enclosure['$'].type || '').toLowerCase();
    if (type.startsWith('image/')) {
      return { url: item.enclosure['$'].url, source: 'enclosure' };
    }
  }
  return null;
}

async function fetchImageMetadata(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PortalContentHub/1.0)'
      },
      timeout: 10000
    });
    
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('text/html') && !contentType.startsWith('application/json')) return null;
    
    const html = await res.text();
    
    // og:image
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImage && isValidImageUrl(ogImage[1])) {
      if (await validateImage(ogImage[1])) return { url: ogImage[1], source: 'og:image' };
    }
    
    // twitter:image
    const twitterImage = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (twitterImage && isValidImageUrl(twitterImage[1])) {
      return { url: twitterImage[1], source: 'twitter:image' };
    }
    
    // link rel="image_src"
    const imageSrc = html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i);
    if (imageSrc && isValidImageUrl(imageSrc[1])) {
      return { url: imageSrc[1], source: 'link:image_src' };
    }
    
    // JSON-LD image
    const jsonLdMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch) {
      try {
        const json = JSON.parse(jsonLdMatch[1]);
        const findImage = (obj) => {
          if (typeof obj === 'object' && obj !== null) {
            if (obj.image && typeof obj.image === 'string' && isValidImageUrl(obj.image)) return obj.image;
            if (obj.image && obj.image.url && isValidImageUrl(obj.image.url)) return obj.image.url;
            for (const v of Object.values(obj)) {
              const found = findImage(v);
              if (found) return found;
            }
          } else if (Array.isArray(obj)) {
            for (const item of obj) {
              const found = findImage(item);
              if (found) return found;
            }
          }
          return null;
        };
        const found = findImage(json);
        if (found) return { url: found, source: 'json-ld' };
      } catch (e) {}
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

async function harvestFeed(source, db) {
  const startTime = Date.now();
  let itemsFound = 0, itemsInserted = 0, itemsUpdated = 0, itemsSkipped = 0, errorCount = 0;
  let errorMessage = null;
  let status = 'HEALTHY';
  let newestPublishedAt = null;
  
  try {
    const response = await fetch(source.feed_url, {timeout:15000});
    if (!response.ok) throw new Error('HTTP '+response.status);
    const rawXml=await response.text();
    let feed;
    if(source.feed_url.includes('zetizen.com') && rawXml.includes('<articles>')) {
      const $=require('cheerio').load(rawXml,{xmlMode:true});
      feed={items:$('articles > article').map((i,e)=>{const a=$(e);const rawDate=a.children('publishTimeUnix').text().trim();const parsed=normalizeDate(rawDate+' GMT+0700');return {title:a.children('title').text(),link:a.children('sourceUrl').text().trim(),guid:a.children('ID').text().trim(),isoDate:parsed,description:truncateText(stripHtml(a.find('contents > text > content').first().text()),350),author:a.children('author').text(),enclosure:{url:a.find('contents > image > url').first().text()}};}).get()};
    } else feed = await parser.parseString(rawXml);
    feed.items = (feed.items || []).slice(0,50);
    itemsFound = feed.items ? feed.items.length : 0;
    
    if (itemsFound === 0) {
      status = 'EMPTY';
      errorMessage = 'Feed tidak mengandung item';
    }
    
    const insertNews = db.prepare(`INSERT OR REPLACE INTO news_items (id, source_id, source_name, title, original_url, canonical_url, guid, author, source_description, source_summary, summary, summary_method, editorial_summary, keywords, keyword_extraction_method, keywords_generated_at, published_at, fetched_at, first_seen_at, last_seen_at, image_url, image_source, image_credit, image_status, image_fetched_at, categories, editorial_category, audience_segment, deduplication_key, freshness_status, relevance_score, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const updateSource = db.prepare(`UPDATE rss_sources SET last_attempt_at = ?, last_success_at = ?, last_article_published_at = ?, last_error = ?, consecutive_errors = ?, item_count = ?, status = ?, freshness_state = ?, updated_at = datetime('now') WHERE id = ?`);
    const insertSyncRun = db.prepare(`INSERT INTO sync_runs (id, sync_type, source_id, started_at, completed_at, status, items_found, items_inserted, items_updated, items_skipped, error_count, error_message, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    
    const runId = generateId();
    const fetchTime = nowISO();
    
    for (const item of feed.items || []) {
      const title = stripHtml(item.title || '') || '(Tanpa Judul)';
      const originalUrl = item.link || item.url || '';
      const guid = item.guid || item.id || originalUrl;
      const pubDate = normalizeDate(item.isoDate || item.pubDate || item['dc:date']);
      const sourceDesc = stripHtml(item.content || item.description || item['content:encoded'] || '');
      const sourceSummary = stripHtml(item.summary || item['content:encoded'] || item.description || '');
      
      // Deduplikasi
      const dedupKey = createDedupKey(guid || originalUrl || title, source.id, (guid || originalUrl) ? '' : pubDate || '');
      const existing = db.prepare('SELECT * FROM news_items WHERE deduplication_key = ?').get(dedupKey);
      if (pubDate && (!newestPublishedAt || pubDate > newestPublishedAt)) newestPublishedAt=pubDate;
      if(existing && existing.title===title && existing.source_description===sourceDesc && existing.source_summary===sourceSummary) {
        db.prepare('UPDATE news_items SET last_seen_at=? WHERE id=?').run(fetchTime,existing.id);itemsSkipped++;continue;
      }
      
      // Ringkasan tanpa AI
      let summary = null;
      let summaryMethod = 'unavailable';
      
      if (sourceDesc) {
        summary = sourceDesc;
        summaryMethod = 'publisher_summary';
      }
      if (!summary && sourceSummary) {
        summary = extractiveSummary(null, sourceSummary);
        summaryMethod = 'extractive';
      }
      if (!summary) {
        summary = title; // fallback ke judul
        summaryMethod = 'unavailable';
      }
      
      // Batasi panjang pratinjau 250-350 karakter
      if (summary && summary.length > 350) {
        summary = truncateText(summary, 350);
      }
      
      // Ekstraksi kata kunci
      const keywords = extractKeywords(title, sourceDesc, source.category, 8);
      const keywordsJson = JSON.stringify(keywords);
      
      // Kategori editorial
      const editorialCategory = determineCategory(title, sourceDesc, source.category, source.region);
      const audienceSegment = determineAudienceSegment(title, sourceDesc, editorialCategory);
      
      // Resolusi gambar
      let imageUrl = null;
      let imageSource = null;
      let imageCredit = null;
      let imageStatus = 'unavailable';
      let imageFetchedAt = null;
      
      const rssImage = extractImageFromItem(item) || (item.enclosure?.url ? {url:item.enclosure.url,source:'enclosure'} : null);
      if (rssImage && isValidImageUrl(rssImage.url) && await validateImage(rssImage.url)) {
        imageUrl = rssImage.url;
        imageSource = rssImage.source;
        imageCredit = source.publisher || source.name;
        imageStatus = 'ok';
        imageFetchedAt = fetchTime;
      } else if (itemsInserted + itemsUpdated < 3 && originalUrl && !originalUrl.includes('news.google.com')) {
        // Coba ambil dari metadata halaman penerbit
        const publisherImage = await fetchImageMetadata(originalUrl);
        if (publisherImage && isValidImageUrl(publisherImage.url)) {
          imageUrl = publisherImage.url;
          imageSource = publisherImage.source;
          imageCredit = source.publisher || source.name;
          imageStatus = 'ok';
          imageFetchedAt = fetchTime;
        }
      }
      
      const id = existing ? existing.id : generateId();
      const isNew = !existing;
      
      insertNews.run(
        id, source.id, source.name, title, originalUrl, originalUrl, guid,
        item.creator || item.author || '', sourceDesc, sourceSummary,
        existing?.editorial_summary || summary, existing?.editorial_summary ? 'human_editorial' : summaryMethod, existing?.editorial_summary || null, keywordsJson, 'rule_based', nowISO(),
        pubDate, fetchTime, existing?.first_seen_at || fetchTime, fetchTime,
        imageUrl || existing?.image_url || null, imageSource || existing?.image_source || null, imageCredit || existing?.image_credit || null, imageUrl ? imageStatus : existing?.image_status || imageStatus, imageFetchedAt || existing?.image_fetched_at || null,
        JSON.stringify([source.category || 'Umum']), editorialCategory, audienceSegment,
        dedupKey, 'fresh', 0, 1
      );
      
      if (isNew) {
        itemsInserted++;
      } else {
        itemsUpdated++;
        db.prepare(`UPDATE news_items SET last_seen_at = datetime('now') WHERE id = ?`).run(id);
      }
      
      if (pubDate && (!newestPublishedAt || pubDate > newestPublishedAt)) {
        newestPublishedAt = pubDate;
      }
    }
    
    // Update source status
    if (newestPublishedAt && Date.now()-Date.parse(newestPublishedAt) > 14*86400000) status='STALE';
    const consecutiveErrors = status === 'ERROR' ? (source.consecutive_errors || 0) + 1 : 0;
    updateSource.run(fetchTime, status !== 'ERROR' ? fetchTime : source.last_success_at,
      newestPublishedAt, errorMessage, consecutiveErrors, itemsFound, status, status, source.id);
    
    insertSyncRun.run(runId, 'rss', source.id, new Date(startTime).toISOString(), nowISO(), status, itemsFound, itemsInserted, itemsUpdated, itemsSkipped, errorCount, errorMessage, Date.now() - startTime);
    
  } catch (err) {
    errorCount++;
    errorMessage = err.message;
    status = 'ERROR';
    
    const updateSource = db.prepare(`UPDATE rss_sources SET last_attempt_at = ?, last_error = ?, consecutive_errors = consecutive_errors + 1, status = 'ERROR', updated_at = datetime('now') WHERE id = ?`);
    updateSource.run(nowISO(), errorMessage, source.id);
    
    const insertSyncRun = db.prepare(`INSERT INTO sync_runs (id, sync_type, source_id, started_at, completed_at, status, items_found, items_inserted, items_updated, items_skipped, error_count, error_message, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertSyncRun.run(generateId(), 'rss', source.id, new Date(startTime).toISOString(), nowISO(), 'FAILED', itemsFound, itemsInserted, itemsUpdated, itemsSkipped, errorCount, errorMessage, Date.now() - startTime);
  }
  
  return { sourceId: source.id, sourceName: source.name, status, itemsFound, itemsInserted, itemsUpdated, itemsSkipped, errorCount, errorMessage, durationMs: Date.now() - startTime };
}

async function syncAllRSS(db) {
  const sources = db.prepare('SELECT * FROM rss_sources WHERE is_active = 1').all();
  const results = [];
  
  for (const source of sources) {
    try {
      const result = await harvestFeed(source, db);
      results.push(result);
    } catch (err) {
      results.push({
        sourceId: source.id,
        sourceName: source.name,
        status: 'ERROR',
        itemsFound: 0,
        itemsInserted: 0,
        itemsUpdated: 0,
        itemsSkipped: 0,
        errorCount: 1,
        errorMessage: err.message,
        durationMs: 0
      });
    }
  }
  
  return results;
}

async function validateImage(url) { try { const r=await fetch(url,{method:'HEAD',timeout:6000}); return r.ok && (r.headers.get('content-type')||'').startsWith('image/'); } catch { return false; } }
module.exports = { syncAllRSS, harvestFeed, extractKeywords, extractiveSummary, fetchImageMetadata, validateImage };
