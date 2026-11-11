import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const mode=process.argv[2] ?? 'after';
const browser=await chromium.launch();
const results=[];const unexpected=[];
try {
 const context=await browser.newContext({viewport:{width:1366,height:768},deviceScaleFactor:1,serviceWorkers:'block'});
 await context.route('**/*',async r=>{
  const u=new URL(r.request().url());
  if(u.origin==='http://127.0.0.1:3027'&&(u.pathname==='/dev/sales-workspace'||u.pathname.startsWith('/_next/')||u.pathname.startsWith('/__nextjs_font/')||u.pathname==='/favicon.ico'))await r.continue();
  else{unexpected.push(r.request().method()+' '+u.href);await r.abort();}
 });
 const page=await context.newPage();page.on('pageerror',e=>unexpected.push(e.message));
 const captures=[['review','completion-review',1366,768],['query','completion-query',1366,768]];
 if(mode==='after')captures.push(['wide','completion-review',1920,1080],['mobile','completion-review',390,844]);
 for(const [name,scenario,width,height]of captures){
  await page.setViewportSize({width,height});
  const url='http://127.0.0.1:3027/dev/sales-workspace?building=willow&unit=lg10&scenario='+scenario+'&role=developer&conversation=few';
  await page.goto(url);await expect(page.getByRole('heading',{level:1})).toBeVisible();await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByLabel('Prototype scenario')).toHaveValue(scenario);
  await expect(page.getByLabel('Prototype role')).toHaveValue('developer');
  const measurement=await page.getByRole('button',{name:'View document',exact:true}).evaluateAll(nodes=>nodes.map(el=>{
   const r=el.getBoundingClientRect();const points=[[r.left+2,r.top+2],[r.right-2,r.top+2],[r.left+2,r.bottom-2],[r.right-2,r.bottom-2],[r.left+r.width/2,r.top+r.height/2]];
   return{top:r.top,bottom:r.bottom,height:r.height,width:r.width,fullyVisible:r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth,unobscured:points.every(([x,y])=>el.contains(document.elementFromPoint(x,y)))};
  }));
  const scroll=await page.evaluate(()=>scrollY);expect(scroll).toBe(0);
  results.push({name,scenario,role:'developer',viewport:{width,height},zoom:'100% (fresh Chromium context, no zoom override)',scroll,toolbar:'visible, Ready, few comments',url,controls:measurement});
  await page.screenshot({path:'artifacts/laptop-density/'+mode+'-'+name+'.png',style:'nextjs-portal{display:none}'});
 }
 expect(unexpected).toEqual([]);
 await writeFile('artifacts/laptop-density/'+mode+'-measurements.json',JSON.stringify({results,unexpected},null,2));
 console.log(JSON.stringify(results.map(({name,controls})=>({name,controls})),null,2));
}finally{await browser.close();}
