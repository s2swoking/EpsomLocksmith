// Run from a network allowed to reach the public site: node scripts/check-live-seo.mjs
import assert from 'node:assert/strict';
const base='https://epsomlocksmiths.co.uk';
let failures=0;
async function check(name,fn){try{await fn();console.log('PASS',name);}catch(e){failures++;console.error('FAIL',name,e.message);}}
async function get(url,options={}){return fetch(url,{signal:AbortSignal.timeout(15000),...options});}
await check('robots.txt permits crawling and references the sitemap',async()=>{
 const r=await get(base+'/robots.txt');assert.equal(r.status,200);const text=await r.text();assert.match(text,/Sitemap:\s*https:\/\/epsomlocksmiths.co.uk\/sitemap.xml/);assert.ok(!/Disallow:\s*\/\s*$/m.test(text));
});
let urls=[];
await check('sitemap returns 200 and lists 13 public pages',async()=>{
 const r=await get(base+'/sitemap.xml');assert.equal(r.status,200);urls=[...(await r.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map(x=>x[1]);assert.equal(urls.length,13);
});
for(const url of urls)await check(url,async()=>{
 const start=performance.now(),r=await get(url),text=await r.text();
 assert.equal(r.status,200);assert.equal(new URL(r.url).origin,base);
 assert.ok(!/noindex/i.test(r.headers.get('x-robots-tag')||''));assert.match(r.headers.get('content-type')||'',/text\/html/);
 assert.ok(text.includes(`rel="canonical" href="${url}"`));assert.ok(!/<meta[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(text));
 console.log(' ',Math.round(performance.now()-start)+'ms response+download; not a Core Web Vitals measurement');
});
for(const origin of ['http://epsomlocksmiths.co.uk','https://www.epsomlocksmiths.co.uk'])await check(origin+' redirects to canonical homepage',async()=>{
 const first=await get(origin+'/',{redirect:'manual'});assert.ok([301,302,307,308].includes(first.status));const last=await get(origin+'/');assert.equal(last.status,200);assert.equal(last.url,base+'/');
});
await check('unknown URL returns a real HTTP 404',async()=>{
 const r=await get(base+'/seo-check-page-that-does-not-exist-20261023/');assert.equal(r.status,404);
});
process.exitCode=failures?1:0;
