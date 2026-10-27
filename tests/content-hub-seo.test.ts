import test from 'node:test';import assert from 'node:assert/strict';
import {sourceSeo,wordLimit} from '../src/lib/content-hub/seo';
test('metadata cuts at word boundaries and cleans markup',()=>{assert.equal(wordLimit('<b>Info</b>   daerah',30),'Info daerah');assert.ok(wordLimit('Kebijakan daerah untuk layanan publik yang lebih baik',25).length<=25);});
test('key points are source extracts, no invented 5W+1H',()=>{const summary='Pemerintah daerah membuka pendaftaran program pelatihan warga. Jadwal lengkap tersedia pada pengumuman resmi pemerintah daerah.';const s=sourceSeo('Pelatihan warga',summary);assert.equal(s.key_points.length,2);for(const p of s.key_points)assert.ok(summary.includes(p));assert.deepEqual(s.section_headings,[]);});
test('insufficient text does not fabricate bullet points',()=>{const s=sourceSeo('Info warga','Informasi singkat.');assert.deepEqual(s.key_points,[]);assert.equal(s.meta_description,'Informasi singkat.');});
