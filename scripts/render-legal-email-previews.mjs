import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { loadTypescriptModule } from '../tests/helpers/load-typescript-module.mjs';
import { emailSnapshot, emailNow, emailExpiry } from '../tests/helpers/legal-email-fixture.mjs';

const { renderLegalEmail }=loadTypescriptModule('src/lib/sales/legal-workflow.ts');
const folder=path.resolve('artifacts/legal-emails');
await mkdir(folder,{recursive:true});
const browser=await chromium.launch();
try {
  const page=await browser.newPage();
  // Previews use fictional sale data; never send a message or fetch live data.
  await page.route('**/*',route=>route.abort());
  for(const [kind,name]of [['authority','authority-to-exchange'],['notice_authority','authority-to-serve-notice']]) {
    const email=renderLegalEmail(emailSnapshot,kind,kind==='authority'?emailExpiry:'',emailNow,'https://portal.bunnywell.co.uk');
    await writeFile(path.join(folder,name+'.html'),email.html);
    await writeFile(path.join(folder,name+'.txt'),email.subject+'\n\n'+email.body+'\n');
    await page.setViewportSize({width:800,height:1000});await page.setContent(email.html);
    await page.screenshot({path:path.join(folder,name+'.png'),fullPage:true});
    await page.setViewportSize({width:375,height:900});
    const overflows=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    if(overflows)throw new Error(`${name}: mobile overflow`);
    await page.screenshot({path:path.join(folder,name+'-mobile.png'),fullPage:true});
  }
  process.stdout.write(`Rendered both emails at desktop and mobile sizes in ${folder}\n`);
} finally {await browser.close();}
