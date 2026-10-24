import type { Metadata } from 'next';
import LegalPage from '@/components/LegalPage';
import { SITE } from '@/config/site';
export const metadata: Metadata = { title: 'Kebijakan Privasi', alternates: { canonical: '/privacy-policy' } };

export default function Page() {
  return (
    <LegalPage title="Kebijakan Privasi" updated="Oktober 2026">
      <h2>Data yang kami kumpulkan</h2>
      <p>Kami tidak meminta Anda membuat akun. Server dan penyedia hosting dapat mencatat data teknis standar seperti alamat IP, jenis peramban, dan halaman yang dibuka. Preferensi mode terang/gelap disimpan di perangkat Anda (localStorage).</p>
      <h2>Cookie dan iklan pihak ketiga</h2>
      <p>Kami bekerja sama dengan jaringan iklan pihak ketiga, misalnya Google AdSense, Adsterra, Monetag, atau MGID. Mereka dapat menggunakan cookie atau teknologi serupa untuk menayangkan iklan berdasarkan kunjungan Anda ke situs ini dan situs lain, serta mengukur kinerja iklan.</p>
      <ul>
        <li>Pengguna Google dapat mengatur preferensi iklan di <a href="https://adssettings.google.com" rel="noopener" target="_blank">adssettings.google.com</a>.</li>
        <li>Anda dapat menolak atau menghapus cookie melalui pengaturan peramban Anda.</li>
      </ul>
      <h2>Analitik</h2>
      <p>Kami dapat memakai layanan analitik untuk memahami penggunaan situs secara agregat.</p>
      <h2>Tautan eksternal</h2>
      <p>Situs ini memuat tautan ke situs lain. Kebijakan privasi situs tersebut berada di luar kendali kami.</p>
      <h2>Hak Anda</h2>
      <p>Sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi, Anda dapat meminta informasi, koreksi, atau penghapusan data pribadi Anda yang kami proses dengan menghubungi <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.</p>
      <h2>Perubahan</h2>
      <p>Kebijakan ini dapat diperbarui sewaktu-waktu. Versi terbaru selalu ditampilkan di halaman ini.</p>
    </LegalPage>
  );
}
