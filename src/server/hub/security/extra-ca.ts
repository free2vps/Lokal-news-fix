/**
 * SERTIFIKAT ANTARA (intermediate) YANG TIDAK DIKIRIM OLEH SEBAGIAN SERVER .go.id
 *
 * GEJALA NYATA (diukur 3 Nov 2026): dua situs pemerintah daerah — ntbprov.go.id dan
 * portal.lombokbaratkab.go.id — SELALU gagal diambil dengan galat
 * "SSL certificate problem: unable to get local issuer certificate" (curl kode 60).
 *
 * SEBABNYA: server mereka mengirim sertifikat situsnya saja, TANPA sertifikat antara
 * (intermediate) milik otoritas penerbitnya. Peramban tetap bisa membuka situs itu karena
 * peramban menebak/mengunduh sertifikat antara secara otomatis; Node.js dan banyak klien lain
 * TIDAK melakukan itu, sehingga rantai sertifikat dianggap putus dan koneksi ditolak.
 *
 * PERBAIKANNYA SENGAJA DIBATASI: yang ditambahkan hanyalah sertifikat antara yang SAH dari
 * otoritas publik (Sectigo Public Server Authentication CA DV R36). Verifikasi TETAP penuh:
 *  - nama domain masih dicocokkan (salah domain tetap ditolak),
 *  - masa berlaku masih diperiksa (kedaluwarsa tetap ditolak),
 *  - rantai tetap harus sampai ke akar tepercaya (Sectigo Public Server Authentication Root R46).
 *
 * Ini BUKAN mematikan verifikasi sertifikat. Bukti ujinya ada di tests/hub-extra-ca.test.ts:
 * self-signed.badssl.com, expired.badssl.com, dan wrong.host.badssl.com tetap DITOLAK.
 *
 * Sertifikat diambil dari alamat resmi yang tertulis di dalam sertifikat situsnya:
 *   http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt
 */
import tls from 'node:tls';

/** Sertifikat antara Sectigo DV R36 (berlaku 22 Mar 2021 – 21 Mar 2036). */
export const SECTIGO_DV_R36 = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----`;

/**
 * Daftar akar bawaan Node + sertifikat antara tambahan.
 *
 * Penting: opsi `ca` MENGGANTIKAN daftar akar bawaan, bukan menambah. Karena itu akar bawaan
 * (`tls.rootCertificates`) wajib disertakan lagi — kalau tidak, SEMUA situs lain justru gagal.
 */
export function trustedCa(extra: string[] = [SECTIGO_DV_R36]): string[] {
  return [...tls.rootCertificates, ...extra.filter(Boolean)];
}
