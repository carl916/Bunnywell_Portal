import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const extension = path.resolve('artifacts/permanent-discussion/zoom-extension');
const context = await chromium.launchPersistentContext('', {
  channel:'chromium', headless:true, viewport:{width:1366,height:768},
  args:['--disable-extensions-except='+extension,'--load-extension='+extension],
});
const unexpected=[];
try {
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin==='http://127.0.0.1:3027' && (url.pathname==='/dev/sales-workspace'||url.pathname.startsWith('/_next/')||url.pathname.startsWith('/__nextjs_font/')||['/favicon.ico','/favicon-32x32.png','/icon-192.png'].includes(url.pathname))) await route.continue();
  else {unexpected.push(route.request().url());await route.abort();}
 });
 const worker=context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:3027/dev/sales-workspace?building=willow&unit=lg10&scenario=completion-review&conversation=long');
 const results=[];
 for(const factor of [1.5,2]){
  const actual=await worker.evaluate(async factor=>{
   const tab=(await chrome.tabs.query({})).find(tab=>tab.url?.startsWith('http://127.0.0.1:3027/dev/sales-workspace'));
   await chrome.tabs.setZoom(tab.id,factor);
   return chrome.tabs.getZoom(tab.id);
  },factor);
  expect(actual).toBe(factor);
  await expect.poll(()=>page.evaluate(()=>innerWidth)).toBeLessThan(1000);
  const panel=page.getByRole('complementary',{name:'Comments & activity',exact:true});
  expect(await panel.evaluate(el=>getComputedStyle(el).position)).not.toBe('sticky');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const task=(await page.getByTestId('sale-task').boundingBox());
  const box=await panel.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(task.y+task.height);
  await page.getByRole('button',{name:'Comments and activity',exact:true}).click();
  await expect(panel.getByRole('heading',{name:'Comments & activity',exact:true})).toBeFocused();
  await expect(panel.getByRole('heading',{name:'Comments & activity',exact:true})).toBeInViewport();
  await panel.getByRole('region',{name:'Conversation messages'}).focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('textbox',{name:'Draft comment'})).toBeFocused();
  await expect(panel.getByRole('textbox',{name:'Draft comment'})).toBeInViewport();
  results.push({browserZoom:actual,cssViewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight})),panelPosition:await panel.evaluate(el=>getComputedStyle(el).position),horizontalOverflow:false,keyboardComposerReachable:true});
 }
 expect(unexpected).toEqual([]);
 await writeFile('artifacts/permanent-discussion/browser-zoom.json',JSON.stringify({passed:true,method:'Chrome tabs.setZoom in isolated temporary profile; no CSS zoom or device scale emulation',results,unexpectedRequests:unexpected},null,2));
 console.log(JSON.stringify(results,null,2));
}finally{await context.close();}
