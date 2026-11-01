import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { SITE } from '@/config/site';
export const metadata: Metadata = { title: 'Disclaimer, Hak Cipta & Takedown', alternates: { canonical: '/disclaimer' } };

export default function Page() {
  return (
    <LegalPage title="Disclaimer, Hak Cipta & Takedown" updated="Oktober 2026">
      <h2>1. Sifat layanan</h2>
      <p>{SITE.name} adalah agregator dan kurator berita. Kami tidak memproduksi liputan sendiri. Setiap entri berisi ringkasan singkat yang dibuat otomatis dengan bantuan kecerdasan buatan (AI), disertai nama media sumber dan tautan langsung ke artikel aslinya.</p>
      <h2>2. Hak cipta</h2>
      <p>Seluruh hak cipta atas artikel, foto, dan materi asli tetap dimiliki oleh penerbit atau pemegang hak masing-masing sebagaimana diatur dalam UU No. 28 Tahun 2014 tentang Hak Cipta. Kami tidak menampilkan artikel secara utuh dan tidak memakai iframe. Gambar ditampilkan dengan kredit kepada sumbernya.</p>
      <h2>3. Penggunaan wajar (fair use)</h2>
      <p>Kami hanya memuat ringkasan singkat dengan kalimat sendiri untuk tujuan informasi, selalu menyebut sumber, dan mengarahkan pembaca ke artikel asli. Kami tidak bermaksud menggantikan situs sumber.</p>
      <h2>4. Batas akurasi</h2>
      <p>Ringkasan AI dapat mengandung kekeliruan atau menghilangkan konteks. Rujuk artikel asli sebelum mengambil keputusan. Kami tidak bertanggung jawab atas kerugian akibat penggunaan ringkasan tanpa merujuk sumber.</p>
      <h2>5. Prosedur Notice and Takedown (1x24 jam)</h2>
      <p>Jika Anda pemegang hak dan keberatan atas suatu konten, kirim pemberitahuan ke <a href={`mailto:${SITE.email}`}>{SITE.email}</a> berisi:</p>
      <ul>
        <li>identitas dan kontak Anda, serta bukti kepemilikan hak;</li>
        <li>URL halaman di situs ini yang dipermasalahkan;</li>
        <li>URL materi asli dan alasan keberatan;</li>
        <li>pernyataan bahwa informasi yang Anda sampaikan benar.</li>
      </ul>
      <p>Kami akan menanggapi dan, bila keberatan beralasan, menurunkan konten dalam waktu 1x24 jam sejak pemberitahuan lengkap diterima. Pemegang hak juga dapat meminta agar sumbernya tidak lagi dikumpulkan.</p>
      <h2>6. Tautan keluar & iklan</h2>
      <p>Tautan ke situs sumber dibuka di tab baru dan kami tidak mengendalikan isinya. Iklan di situs ini ditayangkan oleh jaringan iklan pihak ketiga; kami tidak bertanggung jawab atas isi iklan tersebut.</p>
    </LegalPage>
  );
}
