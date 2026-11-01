const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/portal.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  // ============================================================
  // A. RssSource
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS rss_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      feed_url TEXT NOT NULL,
      publisher TEXT,
      category TEXT,
      region TEXT,
      is_active INTEGER DEFAULT 1,
      status TEXT DEFAULT 'UNTESTED',
      last_attempt_at TEXT,
      last_success_at TEXT,
      last_article_published_at TEXT,
      last_error TEXT,
      consecutive_errors INTEGER DEFAULT 0,
      item_count INTEGER DEFAULT 0,
      freshness_state TEXT DEFAULT 'UNKNOWN',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ============================================================
  // B. NewsItem
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      source_name TEXT,
      title TEXT NOT NULL,
      original_url TEXT,
      canonical_url TEXT,
      guid TEXT,
      author TEXT,
      source_description TEXT,
      source_summary TEXT,
      summary TEXT,
      summary_method TEXT DEFAULT 'unavailable',
      editorial_summary TEXT,
      keywords TEXT, -- JSON array
      keyword_extraction_method TEXT DEFAULT 'rule_based',
      keywords_generated_at TEXT,
      published_at TEXT,
      fetched_at TEXT DEFAULT (datetime('now')),
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      image_url TEXT,
      image_source TEXT,
      image_credit TEXT,
      image_status TEXT DEFAULT 'unavailable',
      image_fetched_at TEXT,
      categories TEXT, -- JSON array
      editorial_category TEXT,
      audience_segment TEXT,
      deduplication_key TEXT,
      freshness_status TEXT DEFAULT 'fresh',
      relevance_score REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (source_id) REFERENCES rss_sources(id)
    );
  `);

  // ============================================================
  // C. XTrendSnapshot
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS x_trend_snapshots (
      id TEXT PRIMARY KEY,
      country_code TEXT DEFAULT 'ID',
      source_url TEXT NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'PENDING',
      item_count INTEGER DEFAULT 0,
      error_message TEXT
    );
  `);

  // ============================================================
  // D. XTrendItem
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS x_trend_items (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      trend_text TEXT NOT NULL,
      normalized_trend_text TEXT NOT NULL,
      rank INTEGER,
      source_url TEXT,
      fetched_at TEXT DEFAULT (datetime('now')),
      first_observed_at TEXT,
      last_observed_at TEXT,
      observation_count INTEGER DEFAULT 1,
      source_status TEXT DEFAULT 'OK',
      FOREIGN KEY (snapshot_id) REFERENCES x_trend_snapshots(id)
    );
  `);

  // ============================================================
  // E. YouTubeMusicItem
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS youtube_music_items (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      playlist_id TEXT NOT NULL,
      title TEXT NOT NULL,
      channel_title TEXT,
      description_excerpt TEXT,
      thumbnail_url TEXT,
      video_url TEXT,
      video_published_at TEXT,
      added_to_playlist_at TEXT,
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      is_music INTEGER DEFAULT 0,
      category TEXT,
      source_status TEXT DEFAULT 'PENDING',
      deduplication_key TEXT
    );
  `);

  // ============================================================
  // F. SyncRun
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      sync_type TEXT NOT NULL,
      source_id TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      status TEXT DEFAULT 'RUNNING',
      items_found INTEGER DEFAULT 0,
      items_inserted INTEGER DEFAULT 0,
      items_updated INTEGER DEFAULT 0,
      items_skipped INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      error_message TEXT,
      duration_ms INTEGER
    );
  `);

  // ============================================================
  // G. AppSettings
  // ============================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_news_items_source_id ON news_items(source_id);
    CREATE INDEX IF NOT EXISTS idx_news_items_published_at ON news_items(published_at);
    CREATE INDEX IF NOT EXISTS idx_news_items_fetched_at ON news_items(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_news_items_dedup_key ON news_items(deduplication_key);
    CREATE INDEX IF NOT EXISTS idx_news_items_editorial_category ON news_items(editorial_category);
    CREATE INDEX IF NOT EXISTS idx_news_items_audience_segment ON news_items(audience_segment);
    CREATE INDEX IF NOT EXISTS idx_news_items_is_active ON news_items(is_active);
    CREATE INDEX IF NOT EXISTS idx_rss_sources_is_active ON rss_sources(is_active);
    CREATE INDEX IF NOT EXISTS idx_rss_sources_status ON rss_sources(status);
    CREATE INDEX IF NOT EXISTS idx_x_trend_items_normalized ON x_trend_items(normalized_trend_text);
    CREATE INDEX IF NOT EXISTS idx_x_trend_items_snapshot ON x_trend_items(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_x_trend_snapshots_fetched_at ON x_trend_snapshots(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_youtube_music_items_video_id ON youtube_music_items(video_id);
    CREATE INDEX IF NOT EXISTS idx_youtube_music_items_playlist_id ON youtube_music_items(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_sync_runs_type ON sync_runs(sync_type);
    CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs(started_at);
  `);

  // Seed default RSS sources if empty
  const count = db.prepare('SELECT COUNT(*) as c FROM rss_sources').get().c;
  if (count === 0) {
    const defaultSources = [
      // A.1 Berita lokal NTB
      { name: 'ANTARA Mataram Terkini', feedUrl: 'https://mataram.antaranews.com/rss/terkini.xml', publisher: 'ANTARA', category: 'Berita Lokal NTB', region: 'NTB' },
      { name: 'ANTARA Kabar NTB', feedUrl: 'https://mataram.antaranews.com/rss/kabar-ntb.xml', publisher: 'ANTARA', category: 'Berita Lokal NTB', region: 'NTB' },
      { name: 'ANTARA Sumbawa Barat', feedUrl: 'https://mataram.antaranews.com/rss/kabar-ntb-sumbawa-barat.xml', publisher: 'ANTARA', category: 'Berita Lokal NTB', region: 'NTB' },
      { name: 'ANTARA Kabupaten Sumbawa', feedUrl: 'https://mataram.antaranews.com/rss/kabar-ntb-sumbawa.xml', publisher: 'ANTARA', category: 'Berita Lokal NTB', region: 'NTB' },
      { name: 'ANTARA Mataram Top News', feedUrl: 'https://mataram.antaranews.com/rss/top-news.xml', publisher: 'ANTARA', category: 'Berita Lokal NTB', region: 'NTB' },
      // A.2 Berita nasional
      { name: 'ANTARA Terkini', feedUrl: 'https://www.antaranews.com/rss/terkini.xml', publisher: 'ANTARA', category: 'Berita Nasional', region: 'Nasional' },
      { name: 'ANTARA Top News', feedUrl: 'https://www.antaranews.com/rss/top-news.xml', publisher: 'ANTARA', category: 'Berita Nasional', region: 'Nasional' },
      { name: 'Detik Berita', feedUrl: 'https://news.detik.com/berita/rss', publisher: 'detikcom', category: 'Berita Nasional', region: 'Nasional' },
      { name: 'CNN Indonesia RSS Utama', feedUrl: 'https://www.cnnindonesia.com/rss', publisher: 'CNN Indonesia', category: 'Berita Nasional', region: 'Nasional' },
      { name: 'CNN Indonesia Nasional', feedUrl: 'https://www.cnnindonesia.com/nasional/rss', publisher: 'CNN Indonesia', category: 'Berita Nasional', region: 'Nasional' },
      { name: 'Tempo Nasional', feedUrl: 'https://rss.tempo.co/nasional', publisher: 'Tempo', category: 'Berita Nasional', region: 'Nasional' },
      // A.3 ANTARA kategori
      { name: 'ANTARA Humaniora', feedUrl: 'https://www.antaranews.com/rss/humaniora.xml', publisher: 'ANTARA', category: 'Humaniora', region: 'Nasional' },
      { name: 'ANTARA Teknologi', feedUrl: 'https://www.antaranews.com/rss/tekno.xml', publisher: 'ANTARA', category: 'Teknologi', region: 'Nasional' },
      { name: 'ANTARA Lifestyle', feedUrl: 'https://www.antaranews.com/rss/lifestyle.xml', publisher: 'ANTARA', category: 'Lifestyle', region: 'Nasional' },
      { name: 'ANTARA Hiburan', feedUrl: 'https://www.antaranews.com/rss/hiburan.xml', publisher: 'ANTARA', category: 'Hiburan', region: 'Nasional' },
      { name: 'ANTARA Ekonomi', feedUrl: 'https://www.antaranews.com/rss/ekonomi.xml', publisher: 'ANTARA', category: 'Ekonomi', region: 'Nasional' },
      { name: 'ANTARA Ekonomi dan Bisnis', feedUrl: 'https://www.antaranews.com/rss/ekonomi-bisnis.xml', publisher: 'ANTARA', category: 'Ekonomi dan Bisnis', region: 'Nasional' },
      { name: 'ANTARA Olahraga', feedUrl: 'https://www.antaranews.com/rss/olahraga.xml', publisher: 'ANTARA', category: 'Olahraga', region: 'Nasional' },
      // A.5 Google News berdasarkan topik
      { name: 'Google News - Pemuda dan Gen Z', feedUrl: 'https://news.google.com/rss/search?q=%28pemuda+OR+%22anak+muda%22+OR+%22Gen+Z%22+OR+mahasiswa%29+when%3A7d&hl=id&gl=ID&ceid=ID%3Aid', publisher: 'Google News', category: 'Pemuda dan Komunitas', region: 'Nasional' },
      { name: 'Google News - Pendidikan dan Beasiswa', feedUrl: 'https://news.google.com/rss/search?q=%28beasiswa+OR+mahasiswa+OR+pelajar+OR+kampus+OR+pendidikan%29+when%3A7d&hl=id&gl=ID&ceid=ID%3Aid', publisher: 'Google News', category: 'Pendidikan', region: 'Nasional' },
      { name: 'Google News - Karier dan Pekerjaan', feedUrl: 'https://news.google.com/rss/search?q=%28magang+OR+%22lowongan+kerja%22+OR+karier+OR+%22fresh+graduate%22+OR+%22skill+digital%22%29+when%3A7d&hl=id&gl=ID&ceid=ID%3Aid', publisher: 'Google News', category: 'Karier', region: 'Nasional' },
      { name: 'Google News - Wirausaha dan Startup', feedUrl: 'https://news.google.com/rss/search?q=%28%22wirausaha+muda%22+OR+startup+OR+%22bisnis+anak+muda%22+OR+UMKM%29+when%3A7d&hl=id&gl=ID&ceid=ID%3Aid', publisher: 'Google News', category: 'Ekonomi dan Bisnis', region: 'Nasional' },
      { name: 'Google News - Teknologi dan Tren Digital', feedUrl: 'https://news.google.com/rss/search?q=%28AI+OR+teknologi+OR+TikTok+OR+%22media+sosial%22+OR+gaming%29+when%3A7d&hl=id&gl=ID&ceid=ID%3Aid', publisher: 'Google News', category: 'Teknologi', region: 'Nasional' },
      { name: 'Google News - Kesehatan dan Gaya Hidup', feedUrl: 'https://news.google.com/rss/search?q=%28%22kesehatan+mental%22+OR+%22gaya+hidup%22+OR+pergaulan+OR+olahraga%29+when%3A7d&hl=id&gl=ID&ceid=ID%3Aid', publisher: 'Google News', category: 'Kesehatan', region: 'Nasional' },
      { name: 'Google News - Prestasi dan Komunitas Pemuda', feedUrl: 'https://news.google.com/rss/search?q=%28%22prestasi+mahasiswa%22+OR+%22komunitas+pemuda%22+OR+%22inovasi+pemuda%22+OR+%22kreativitas+anak+muda%22%29+when%3A7d&hl=id&gl=ID&ceid=ID%3Aid', publisher: 'Google News', category: 'Pemuda dan Komunitas', region: 'Nasional' },
      { name: 'Google Trends Indonesia', feedUrl: 'https://trends.google.com/trending/rss?geo=ID', publisher: 'Google Trends', category: 'Tren Media Sosial', region: 'Nasional' },
    ];

    const insertSource = db.prepare(`INSERT INTO rss_sources (id, name, feed_url, publisher, category, region, is_active, status, freshness_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const crypto = require('crypto');
    for (const s of defaultSources) {
      const id = crypto.randomUUID();
      insertSource.run(id, s.name, s.feedUrl, s.publisher, s.category, s.region, 1, 'UNTESTED', 'UNKNOWN');
    }
  }

  const optional = ['after-school','campus','scholarship-info','career-coach','life','dear-you','trend','techno','games','sports-and-health','music','movie','showbiz','food-traveling','news','opini'];
  for (const slug of optional) {
    const url = `https://www.zetizen.com/rss/${slug}/rss.xml`;
    if (!db.prepare('SELECT id FROM rss_sources WHERE feed_url=?').get(url)) db.prepare('INSERT INTO rss_sources (id,name,feed_url,publisher,category,region,is_active) VALUES (?,?,?,?,?,?,0)').run(require('crypto').randomUUID(), 'Zetizen '+slug,url,'Zetizen',slug,'Nasional');
  }
  // Seed default settings if empty
  const settingsCount = db.prepare('SELECT COUNT(*) as c FROM app_settings').get().c;
  if (settingsCount === 0) {
    const defaultSettings = [
      ['rss_sync_interval_hours', '3'],
      ['youtube_sync_interval_hours', '3'],
      ['x_sync_interval_hours', '1'],
      ['x_refresh_cooldown_minutes', '10'],
      ['timezone', 'Asia/Makassar'],
      ['max_items_per_feed', '50'],
      ['news_retention_days', '90'],
      ['trends_retention_days', '30'],
      ['youtube_retention_days', '90'],
      ['public_feed_limit', '50'],
      ['default_freshness_hours', '24'],
      ['last_global_sync_at', ''],
      ['portal_api_enabled', '1'],
    ];
    const insertSetting = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)');
    for (const [key, value] of defaultSettings) {
      insertSetting.run(key, value);
    }
  }

  return db;
}

module.exports = { initDatabase, db };
