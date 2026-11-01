const test=require('node:test'),assert=require('node:assert/strict');
const {stripHtml,normalizeDate,isValidImageUrl}=require('../src/utils/helpers');
const {getXTrendsInWindow}=require('../src/services/xTrends');
test('HTML dibersihkan',()=>assert.equal(stripHtml('<b>Judul</b><script>bad()</script>'),'Judul'));
test('tanggal invalid null',()=>assert.equal(normalizeDate('invalid'),null));
test('Google logo ditolak',()=>assert.equal(isValidImageUrl('https://www.google.com/logo.png'),false));
test('Trends24 hanya mengambil snapshot satu jam',()=>{const {parseOneHour}=require('../src/services/xTrends');const card=(t,text)=>`<div><h3 data-timestamp="${t}">waktu</h3><ol class="trend-card__list"><li><a class="trend-link">${text}</a></li></ol></div>`;const d=parseOneHour(card(10000,'terbaru')+card(6400,'satu jam')+card(2800,'dua jam'));assert.equal(d.items.length,1);assert.equal(d.items[0].text,'satu jam');});
