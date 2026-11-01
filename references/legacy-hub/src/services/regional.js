// Geography is inferred from article text, never solely from publisher location.
const TERMS={ntb:['nusa tenggara barat','ntb','lombok','mataram','sumbawa','bima','dompu','taliwang'],bali:['bali','denpasar','badung','gianyar','tabanan','jembrana','karangasem','buleleng','klungkung','bangli'],ntt:['nusa tenggara timur','ntt','kupang','flores','manggarai','ende','maumere','labuan bajo','rote','alor','lembata','sumba']};
function hits(text,term){return new RegExp('(?<![\\p{L}])'+term+'(?![\\p{L}])','iu').test(text);}
function classify(n){const title=String(n.title||'');const body=String(n.source_description||n.source_summary||n.summary||'').replace(/<[^>]*>/g,' ');const regions=[];for(const [region,terms] of Object.entries(TERMS)){if(terms.some(t=>hits(title,t))||terms.filter(t=>hits(body,t)).length>=2)regions.push(region);}
 return {regions,primaryRegion:regions.length===1?regions[0]:null,geographyStatus:regions.length?'regional':/\b(indonesia|nasional|seluruh provinsi|pemerintah pusat)\b/i.test(title+' '+body)?'national':'unknown'};
}
function regionalOrder(items){return items.map(n=>({...n,...classify(n)})).filter(n=>n.geographyStatus==='regional');}
module.exports={classify,regionalOrder,TERMS};
