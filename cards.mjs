// קרוסלת NOVEMBER SALE: מצלם 10 כרטיסים ריבועיים (1080) ממשימת קרוסלה (carouselJob של המכונה), בעיצוב של הסרטון.
// node cards.mjs <job.json> <outDir> <prefix>  ->  <outDir>/<prefix>-01.jpg ... -10.jpg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const [jobFile, outDir, prefix] = process.argv.slice(2);
if (!jobFile || !outDir || !prefix) throw new Error('usage: node cards.mjs <job.json> <outDir> <prefix>');
const root = path.dirname(fileURLToPath(import.meta.url));
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
const tpl = fs.readFileSync(path.join(root, 'template-carousel/index.html'), 'utf8');
const html = tpl.replace(/\/\*CARDS\*\/[\s\S]*?\/\*CARDS\*\//, `/*CARDS*/${JSON.stringify(job)}/*CARDS*/`);
const tmp = path.join(root, 'template-carousel', `_${job.plate}.html`); // באותה תיקייה, כדי שהגופנים והלוגו ייטענו
fs.writeFileSync(tmp, html);
const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome');
const browser = await puppeteer.launch({ executablePath: chrome, args: ['--no-sandbox', '--allow-file-access-from-files'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  const broken = await page.$$eval('.photo img', (a) => a.filter((i) => !i.complete || !i.naturalWidth).length);
  if (broken) throw new Error(`${broken} תמונות לא נטענו`);
  fs.mkdirSync(outDir, { recursive: true });
  const cards = await page.$$('.card');
  for (const [i, el] of cards.entries()) await el.screenshot({ path: path.join(outDir, `${prefix}-${String(i + 1).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 90 });
  console.log(`OK ${job.plate} ${cards.length} כרטיסים`);
} finally { await browser.close(); fs.rmSync(tmp, { force: true }); }
