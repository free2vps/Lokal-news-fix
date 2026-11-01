/** Deterministic, source-only editorial metadata. No LLM, new facts or network requests. */
export function cleanText(value:string){return value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
export function wordLimit(value:string,max:number){
 const text=cleanText(value);if(text.length<=max)return text;
 const slice=text.slice(0,max-1),boundary=slice.lastIndexOf(' ');
 return (boundary>max/2?slice.slice(0,boundary):slice).trimEnd()+'…';
}
export function sourceSeo(title:string,summary:string){
 const plain=cleanText(summary);
 // Extract complete sentences only; do not claim inferred 5W+1H or create missing facts.
 const sentences=(plain.match(/[^.!?]+[.!?]+(?=\s|$)/g)||[]).map(s=>s.trim());
 const points=[...new Set(sentences)].filter(s=>s.length>=35&&s.length<=220).slice(0,3);
 const paragraphs=summary.split(/\n\s*\n/).map(cleanText).filter(Boolean);
 return {meta_title:wordLimit(title,65),meta_description:wordLimit(plain||title,155),
  key_points:points.length>=2?points:[],
  section_headings:paragraphs.slice(1).map((_,i)=>i===0?'Konteks dari sumber':'Informasi lanjutan')};
}
