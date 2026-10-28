require('dotenv').config({quiet:true});
const {chromium}=require('@playwright/test'),fs=require('fs');
(async()=>{
 const n=JSON.parse(fs.readFileSync('/home/user/preview-audit/ai-candidate-failover.json'));
 const result=JSON.parse(fs.readFileSync('/home/user/preview-audit/e2e-html-result.json'));
 const local=process.argv.includes('--local');if(local)result.articleURL='http://127.0.0.1:3001'+new URL(result.articleURL).pathname;
 const browser=await chromium.launch({args:['--no-sandbox']});
 let page;
 try{
  page=await browser.newPage({viewport:{width:1280,height:900}});
  const origin=new URL(result.articleURL).origin,errors=[];
  page.on('pageerror',e=>errors.push(String(e.message).split(process.env.VERCEL_AUTOMATION_BYPASS_SECRET||'__none__').join('[redacted]').slice(0,600)));
  await page.route('**/*',async route=>{try{
   if(local||new URL(route.request().url()).origin!==origin)return await route.continue();
   const response=await route.fetch({maxRedirects:0,headers:{...route.request().headers(),'x-vercel-protection-bypass':process.env.VERCEL_AUTOMATION_BYPASS_SECRET}});
   return await route.fulfill({response});
  }catch{await route.abort().catch(()=>{});}});
  const response=await page.goto(result.articleURL,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForTimeout(1500);
  const actual=await page.evaluate(url=>({title:document.title,h1:document.querySelector('h1')?.textContent,description:document.querySelector('meta[name=description]')?.content,sourceLink:[...document.querySelectorAll('a')].some(a=>a.href===url)}),n.original_url);
  const checks={http:response.status(),titleMatches:actual.title.startsWith(n.meta_title+' |'),h1Original:actual.h1===n.title,descriptionMatches:actual.description===n.meta_description,sourceLink:actual.sourceLink,javascriptErrors:errors,actual,secretHeaderScope:local?'No bypass header used locally':'Only exact authorized Vercel origin; route.fetch maxRedirects=0; no bypass header to third parties'};
  fs.writeFileSync('/home/user/preview-audit/e2e-browser-'+(local?'local':'preview')+'.json',JSON.stringify(checks,null,2));
  await page.screenshot({path:'/home/user/preview-audit/e2e-ai-article-'+(local?'local':'preview')+'.png',fullPage:true});
  console.log(JSON.stringify(checks));
  if(checks.http!==200||!checks.titleMatches||!checks.h1Original||!checks.descriptionMatches||!checks.sourceLink||errors.length)process.exitCode=1;
 }finally{if(page)await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}
})().catch(()=>{console.error('Verifikasi browser artikel gagal; header request tidak dicetak.');process.exitCode=1;});
