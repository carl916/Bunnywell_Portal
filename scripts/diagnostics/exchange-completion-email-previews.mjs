import fs from 'node:fs';import {chromium} from '@playwright/test';
const out='artifacts/exchange-completion-refinements-20261120';
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/carlg/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'});const results=[];
try{const page=await browser.newPage();await page.route('https://**/*',route=>route.abort());for(const file of fs.readdirSync(out).filter(f=>/^email-.*\.html$/.test(f)))for(const width of [390,1366]){
 await page.setViewportSize({width,height:900});await page.setContent(fs.readFileSync(out+'/'+file,'utf8'));
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(file+' overflow '+width);
 if(await page.locator('a').count()!==1)throw Error('Expected one CTA');
 await page.screenshot({path:out+'/'+file.replace('.html','-'+width+'.png'),fullPage:true});results.push({file,width,overflow:false,cta:1});
}}finally{await browser.close()}
fs.writeFileSync(out+'/email-preview-checks.json',JSON.stringify(results,null,2));console.log('Verified '+results.length+' email layouts.');
