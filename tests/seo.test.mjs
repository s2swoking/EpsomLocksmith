import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve('dist'), origin='https://epsomlocksmiths.co.uk';
const files=['index.html',...readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&existsSync(resolve(root,d.name,'index.html'))).map(d=>d.name+'/index.html')];
const pages=files.map(file=>({file,text:readFileSync(resolve(root,file),'utf8'),url:origin+(file==='index.html'?'/':'/'+file.replace('index.html',''))}));
const textOf=(html,tag)=>[...html.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([\\s\\S]*?)</${tag}>`,'g'))].map(m=>m[1].replace(/<[^>]*>/g,''));
test('13 indexable pages have unique metadata, one h1 and matching canonical/social URLs',()=>{
 assert.equal(pages.length,13);
 const titles=[],descriptions=[];
 for(const p of pages){
  titles.push(textOf(p.text,'title')[0]);
  descriptions.push(p.text.match(/name="description" content="([^"]+)"/)[1]);
  assert.equal(textOf(p.text,'h1').length,1,p.file);
  assert.equal(p.text.match(/rel="canonical" href="([^"]+)"/)[1],p.url);
  assert.equal(p.text.match(/property="og:url" content="([^"]+)"/)[1],p.url);
  assert.ok(!/bitcoin/i.test(p.text));
 }
 assert.equal(new Set(titles).size,13);assert.equal(new Set(descriptions).size,13);
});
test('sitemap contains exactly the public pages, excluding staff and tracking',()=>{
 const urls=[...readFileSync(resolve(root,'sitemap.xml'),'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
 assert.deepEqual(urls.sort(),pages.map(p=>p.url).sort());
});
test('every internal page link and fragment resolves, including nested-page navigation',()=>{
 for(const p of pages)for(const [,href] of p.text.matchAll(/href="([^"]*)"/g)){
  if(!href||/^(tel:|mailto:|https?:)/.test(href))continue;
  const url=new URL(href,p.url);
  if(/\.(css|woff2|svg)$/.test(url.pathname))continue;
  const target=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,'').replace(/\/$/,'/index.html');
  const found=pages.find(x=>x.file===target);assert.ok(found,`${p.file}: ${href}`);
  if(url.hash)assert.ok(found.text.includes(`id="${url.hash.slice(1)}"`),`${p.file}: ${href}`);
 }
});
test('structured data is valid, breadcrumbs match pages, FAQ answers match visible text',()=>{
 for(const p of pages){
  const graph=JSON.parse(p.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  const web=graph.find(n=>['WebPage','FAQPage'].includes(n['@type']));assert.equal(web.url,p.url);
  if(p.file!=='index.html'){
   const crumbs=graph.find(n=>n['@type']==='BreadcrumbList').itemListElement;
   assert.equal(crumbs.at(-1).item,p.url);assert.match(p.text,/aria-label="Breadcrumb"/);
  }
  if(web['@type']==='FAQPage')for(const q of web.mainEntity){assert.ok(p.text.includes(q.name));assert.ok(p.text.includes(q.acceptedAnswer.text));assert.ok(!/pric|cost|payment|fee/i.test(q.name));}
 }
});
test('area pages are distinct compact local content with relevant service links',()=>{
 const areas=pages.filter(p=>p.file.startsWith('locksmith-'));assert.equal(areas.length,4);
 for(const p of areas){assert.ok(!/services-grid|additional-services-grid|£/.test(p.text));assert.ok(p.text.includes('/emergency-door-opening/')||p.text.includes('/lock-repairs-replacement/'));}
 for(const p of pages.filter(p=>p.text.includes('£')))assert.ok(p.text.includes('confirms the price before work starts'));
});

test('all public phone links and business schema use the confirmed business number',()=>{
 for(const p of pages){
  assert.ok(p.text.includes('0203 7720564'),p.file);
  for(const [,number] of p.text.matchAll(/href="tel:([^"]+)"/g))assert.equal(number,'02037720564',p.file);
  const graph=JSON.parse(p.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  assert.equal(graph.find(n=>n['@id']===origin+'/#business').telephone,'+442037720564');
  assert.ok(!/02045058291|020 4505 8291|442045058291/.test(p.text),p.file);
 }
 assert.match(readFileSync(resolve(root,'app.js'),'utf8'),/phone: '0203 7720564'/);
 for(const file of ['dist/enquiry.js','api/contact.mjs'])assert.ok(!/02045058291|020 4505 8291|442045058291/.test(readFileSync(file,'utf8')),file);
});

test('header and footer directly link to every service and area on all public pages',()=>{
 const targets=pages.filter(p=>!['index.html','faq/index.html'].includes(p.file)).map(p=>'/'+p.file.replace('index.html',''));
 for(const p of pages){
  const desktop=p.text.match(/<nav class="desktop-nav"[\s\S]*?<\/nav>/)[0];
  const mobile=p.text.match(/<nav id="mobile-nav"[\s\S]*?<\/nav>/)[0];
  const footer=p.text.match(/<footer>[\s\S]*?<\/footer>/)[0];
  for(const target of targets)for(const nav of [desktop,mobile,footer])assert.ok(nav.includes(`href="${target}"`),`${p.file}: ${target}`);
 }
});
test('area titles use clear location names and 404 is excluded from indexing',()=>{
 for(const name of ['Epsom','Ewell West','Worcester Park','Stoneleigh']){
  const p=pages.find(p=>p.file==='locksmith-'+name.toLowerCase().replaceAll(' ','-')+'/index.html');
  assert.equal(textOf(p.text,'h1')[0],'Locksmith in '+name);
  assert.equal(textOf(p.text,'title')[0],'Locksmith in '+name+' | Epsom Local Locksmith');
 }
 assert.match(readFileSync(resolve(root,'404.html'),'utf8'),/name="robots" content="noindex"/);
});
