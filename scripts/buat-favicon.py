#!/usr/bin/env python3
"""Membuat favicon dari gambar tanda "D" yang dikirim pemilik (40x40 piksel).

Kenapa tidak sekadar diperbesar? Gambar asli hanya 40x40. Bila dibesarkan langsung ke 512,
hasilnya kabur. Karena bentuknya murni geometris, bentuk itu diukur ulang dari pikselnya lalu
digambar ulang secara matematis pada ukuran berapa pun, sehingga tetap tajam.

Hasil ukur dari gambar asli (kisi 40 satuan):
  - cincin (ring)  : pusat (21.6, 17.6), garis tengah r=12.9, tebal 3.6
  - sisi kiri      : garis lurus x=8.7 dari y=17.6 turun ke y=30.25
  - sisi bawah     : garis lurus y=30.25 dari x=8.7 ke x=24.1, lalu menyambung ke cincin
  - titik (dot)    : pusat (15.5, 23.0), jari-jari 3.9
  - warna          : #22355E (34, 53, 94)

Cara pakai:  python3 scripts/buat-favicon.py
Menulis:     src/app/icon.png, src/app/apple-icon.png, public/favicon.ico
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

AKAR = Path(__file__).resolve().parent.parent
WARNA = (34, 53, 94, 255)
SKALA = 60                      # 40 satuan -> 2400 piksel, lalu diperkecil (anti-alias)
SATUAN = 40
KANVAS = SATUAN * SKALA

CX, CY, R_TENGAH, TEBAL = 21.6, 17.6, 13.0, 3.3
X_KIRI = CX - R_TENGAH          # 8.7
Y_BAWAH = 30.25
R_HALF = TEBAL / 2

# Titik sambung sisi bawah ke cincin: potong garis y=Y_BAWAH dengan lingkaran tengah.
dy = Y_BAWAH - CY
dx = math.sqrt(max(R_TENGAH ** 2 - dy ** 2, 0.0))
X_SAMBUNG = CX + dx             # 24.13

DOT = (15.6, 23.0, 3.65)


def garis(g: ImageDraw.ImageDraw, x1: float, y1: float, x2: float, y2: float) -> None:
    """Garis tebal dengan ujung & sambungan bulat (kapsul)."""
    panjang = math.hypot(x2 - x1, y2 - y1)
    langkah = max(int(panjang * SKALA * 2), 2)
    for i in range(langkah + 1):
        t = i / langkah
        x = (x1 + (x2 - x1) * t) * SKALA
        y = (y1 + (y2 - y1) * t) * SKALA
        r = R_HALF * SKALA
        g.ellipse([x - r, y - r, x + r, y + r], fill=WARNA)


def busur(g: ImageDraw.ImageDraw, cx: float, cy: float, r: float, a1: float, a2: float) -> None:
    """Busur dari sudut a1 ke a2 (radian, 0 = kanan, bertambah searah jarum jam layar)."""
    langkah = max(int(abs(a2 - a1) * r * SKALA / 2), 8)
    for i in range(langkah + 1):
        a = a1 + (a2 - a1) * i / langkah
        x = (cx + r * math.cos(a)) * SKALA
        y = (cy + r * math.sin(a)) * SKALA
        rr = R_HALF * SKALA
        g.ellipse([x - rr, y - rr, x + rr, y + rr], fill=WARNA)


def gambar_penanda() -> Image.Image:
    im = Image.new('RGBA', (KANVAS, KANVAS), (0, 0, 0, 0))
    g = ImageDraw.Draw(im)

    # 1. Cincin: dari titik sambung di bawah, mengelilingi sisi kanan + atas, sampai sisi kiri
    #    (x=X_KIRI adalah titik paling kiri lingkaran, jadi bertemu persis dengan garis kiri).
    a_mulai = math.atan2(Y_BAWAH - CY, dx)          # sudut titik sambung (bawah-kanan)
    # Arah: dari titik sambung (bawah-kanan) lewat sisi KANAN, atas, lalu ke titik paling kiri.
    # Sudut mengecil (60° -> 0° -> -90° -> -180°), bukan membesar; kalau dibalik, busurnya
    # memutar lewat sisi bawah dan bentuknya rusak.
    a_akhir = -math.pi
    busur(g, CX, CY, R_TENGAH, a_mulai, a_akhir)

    # 2. Sisi kiri: dari titik paling kiri lingkaran turun ke sudut kiri-bawah.
    garis(g, X_KIRI, CY, X_KIRI, Y_BAWAH)
    # 3. Sisi bawah: dari sudut kiri-bawah ke titik sambung.
    garis(g, X_KIRI, Y_BAWAH, X_SAMBUNG, Y_BAWAH)

    # 4. Titik di dalam.
    x, y, r = DOT
    g.ellipse([(x - r) * SKALA, (y - r) * SKALA, (x + r) * SKALA, (y + r) * SKALA], fill=WARNA)
    return im


def rapikan(im: Image.Image, isi_persen: float = 0.88) -> Image.Image:
    """Potong ke isi, lalu letakkan di tengah kanvas persegi dengan sedikit ruang tepi."""
    kotak = im.getbbox()
    isi = im.crop(kotak)
    sisi = int(max(isi.size) / isi_persen)
    kanvas = Image.new('RGBA', (sisi, sisi), (0, 0, 0, 0))
    kanvas.paste(isi, ((sisi - isi.width) // 2, (sisi - isi.height) // 2), isi)
    return kanvas


def main() -> None:
    penanda = rapikan(gambar_penanda())

    tujuan = [
        (AKAR / 'src/app/icon.png', 512),
        (AKAR / 'src/app/apple-icon.png', 180),
    ]
    for path, ukuran in tujuan:
        path.parent.mkdir(parents=True, exist_ok=True)
        penanda.resize((ukuran, ukuran), Image.LANCZOS).save(path, optimize=True)
        print('tulis', path.relative_to(AKAR), ukuran)

    ico = AKAR / 'public/favicon.ico'
    ico.parent.mkdir(parents=True, exist_ok=True)
    penanda.resize((256, 256), Image.LANCZOS).save(ico, format='ICO',
                                                   sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print('tulis', ico.relative_to(AKAR), '16/32/48/64')


if __name__ == '__main__':
    main()
