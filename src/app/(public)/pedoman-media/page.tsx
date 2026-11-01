import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { SITE } from '@/config/site';
export const metadata: Metadata = { title: 'Pedoman Media & Hak Jawab', alternates: { canonical: '/pedoman-media' } };

export default function Page() {
  return (
    <LegalPage title="Pedoman Media & Hak Jawab" updated="Oktober 2026">
      <h2>Prinsip kami</h2>
      <p>{SITE.name} berupaya menyajikan ringkasan yang akurat, berimbang, dan tidak menambahkan fakta di luar sumber. Setiap ringkasan mencantumkan media sumber dan tautan ke artikel aslinya.</p>
      <h2>Hak jawab dan hak koreksi</h2>
      <p>Sesuai semangat UU No. 40 Tahun 1999 tentang Pers, setiap orang atau pihak yang merasa dirugikan oleh pemberitaan berhak mengajukan hak jawab dan hak koreksi. Karena isi asli berasal dari media sumber, hak jawab sebaiknya juga diajukan kepada media tersebut.</p>
      <h2>Cara mengajukan pengaduan</h2>
      <ul>
        <li>Kirim email ke <a href={`mailto:${SITE.email}`}>{SITE.email}</a> dengan subjek “Hak Jawab” atau “Koreksi”.</li>
        <li>Cantumkan URL halaman, bagian yang keliru, dan data yang benar beserta buktinya.</li>
        <li>Sertakan nama dan kontak agar kami dapat menghubungi Anda.</li>
      </ul>
      <h2>Penanganan</h2>
      <p>Kami meninjau pengaduan secepatnya dan menanggapi paling lambat 2x24 jam. Ringkasan yang terbukti keliru akan diperbaiki atau diturunkan, dan hak jawab yang sah dapat dimuat di halaman terkait.</p>
      <h2>Kontak pengaduan admin</h2>
      <p>Email: <a href={`mailto:${SITE.email}`}>{SITE.email}</a></p>
    </LegalPage>
  );
}
