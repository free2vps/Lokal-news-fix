/**
 * Klasifikasi kategori berita — DETERMINISTIK (aturan kata), bukan AI.
 * Nama kategori harus sama persis dengan daftar kategori portal agar filter di situs bekerja.
 */
export const TOPIC_RULES: {name: string; re: RegExp}[] = [
  {name: 'Hukum & Kriminal', re: /\b(hukum|pidana|tersangka|terdakwa|kejaksaan|kejari|pengadilan|vonis|sidang|korupsi|kpk|penjara|lapas|narkoba|narkotika|polisi|polres|polsek|polda|pencurian|perampokan|pembunuhan|penganiayaan|kasus|tersangka|banding|kasasi)\b/i},
  {name: 'Politik', re: /\b(pemilu|pilpres|pileg|pilgub|pilbup|pilwalkot|partai|koalisi|kampanye|capres|cawapres|caleg|dpr\b|dprd|mpr|dpd|kabinet|menteri|presiden|wakil presiden|politik|pilkada|kpu|bawaslu)\b/i},
  {name: 'Ekonomi', re: /\b(ekonomi|inflasi|harga|harga pangan|cabai|beras|minyak goreng|apbn|apbd|pajak|investasi|ekspor|impor|dagang|perdagangan|umkm|bank|perbankan|kredit|pinjaman|rupiah|saham|ihsg|bisnis|pasar|pendapatan|upah|gaji minimum|bahan bakar|bbm|subsidi|pariwisata.*pendapatan)\b/i},
  {name: 'Kesehatan', re: /\b(kesehatan|rumah sakit|puskesmas|dokter|perawat|pasien|virus|flu|dbd|demam berdarah|malaria|stunting|gizi|vaksin|imunisasi|obat|apotek|klinik|pandemi|covid|balita|kehamilan|puskesmas|bpjs kesehatan)\b/i},
  {name: 'Pendidikan', re: /\b(pendidikan|sekolah|siswa|murid|guru|dosen|mahasiswa|kampus|universitas|beasiswa|kurikulum|ujian|un\b|snbt|cpns|pppk|asn|ppdb|sma|smk|smp|sd\b|pondok|pesantren|kelulusan|wisuda)\b/i},
  {name: 'Teknologi', re: /\b(teknologi|digital|internet|aplikasi|aplikasi|platform|startup|kecerdasan buatan|ai\b|artificial intelligence|data|server|jaringan|siber|cyber|hp\b|smartphone|gadget|komputer|satelit|robot|chip|software|fintech|e-commerce|media sosial)\b/i},
  {name: 'Lingkungan', re: /\b(lingkungan|sampah|limbah|pencemaran|polusi|iklim|emisi|karbon|hutan|mangrove|konservasi|satwa|alam|banjir|kekeringan|cuaca|gempa|erupsi|gunung|tsunami|bmkg|bencana|kebakaran hutan|karhutla|daur ulang)\b/i},
  {name: 'Olahraga', re: /\b(olahraga|sepak ?bola|liga|persib|persebaya|bali united|timnas|pssi|bulu tangkis|badminton|voli|basket|atlet|porprov|pon\b|olimpiade|sea games|asian games|motogp|f1\b|tinju|renang|maraton|pelatih|pertandingan|klasemen)\b/i},
  {name: 'Info Pemda', re: /\b(pemda|pemkab|pemkot|pemprov|bupati|wakil bupati|wali ?kota|wakil wali kota|gubernur|wakil gubernur|dprd|apbd|bappeda|sekda|dinas|kantor wilayah|perangkat daerah|opd)\b/i},
  {name: 'Peristiwa Daerah', re: /\b(kecelakaan|laka|tabrakan|kebakaran|banjir|longsor|gempa|ditemukan tewas|hilang|basarnas|bpbd|evakuasi|korban|tenggelam|kebakaran rumah|rumah roboh|pohon tumbang)\b/i},
  {name: 'Lowongan & CPNS', re: /\b(lowongan|loker|rekrutmen|seleksi (calon )?(cpns|pppk|asn|pegawai)|formasi cpns|pendaftaran cpns|bursa kerja|job fair)\b/i},
  {name: 'Event & Kebijakan Lokal', re: /\b(festival|pekan raya|bazar|musrenbang|sosialisasi|perda|perbup|pergub|peraturan (bupati|daerah|gubernur|wali ?kota)|kebijakan|rakor|rapat koordinasi|anjangsana)\b/i},
  {name: 'Sosial & Budaya', re: /\b(sosial|budaya|adat|tradisi|komunitas|relawan|donasi|bantuan sosial|bansos|panti|disabilitas|pernikahan|budaya lokal|upacara|ritual|seni tradisi)\b/i},
  {name: 'Selebriti', re: /\b(selebriti|artis|aktor|aktris|penyanyi|band|drama|sinetron|seleb|influencer|viral|nikah|pernikahan artis|kabar artis)\b/i},
  {name: 'Film & Musik', re: /\b(film|movie|bioskop|musik|album|konser|lagu|single|festival film|serial|series|netflix|soundtrack)\b/i},
  {name: 'Kuliner & Wisata', re: /\b(kuliner|wisata|destinasi|hotel|resort|pantai|travel|jalan-jalan|makanan|restoran|kafe|homestay|paket wisata|tiket masuk wisata)\b/i},
  {name: 'Gaya Hidup', re: /\b(gaya hidup|fashion|mode|kecantikan|skincare|kesehatan mental|hobi|dekorasi|parenting|tips)\b/i},
];

/** Berita tanpa kata kunci yang jelas tetap punya kategori jujur: "Umum". */
export function topicOf(input: {title?: unknown; summary?: unknown}): string {
  const text = `${String(input.title || '')} ${String(input.summary || '')}`.replace(/\s+/g, ' ').trim();
  if (!text) return 'Umum';
  for (const rule of TOPIC_RULES) if (rule.re.test(text)) return rule.name;
  return 'Umum';
}
