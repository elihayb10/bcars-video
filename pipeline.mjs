// הצינור בענן (GitHub Actions, פעמיים ביום, שעה וחצי לפני מכונת המלאי): סרטון NOVEMBER SALE עדכני לכל רכב במלאי, בלי מחשב.
// 1. נתונים מהאתר ומהפיד (video_data.cjs, נגזר מהסקריפט של המכונה)  2. משימה לכל רכב, עם חתימה (sig)
// 3. נבנה רק מה שחדש או שהשתנה (מחיר, ק"מ, תמונות)  4. נשמר בגרסה "videos-sale" (מחוץ להיסטוריה)  5. רכב שנמכר: הסרטון נמחק
// 6. videos-sale.json: הסרטונים העדכניים והחתימות. המכונה בענן מעלה מהם למטא רק סרטון שהחתימה שלו זהה לנתונים של היום
// 7. stock.json (גרסה "data"): המלאי בלי מחירים
// קבצי המשימה (עם המחירים) לא נשמרים במאגר. רכב שמחיר הפרסום שלו זהה למחירון לא מקבל סרטון (עוד לא נקבע מחיר, אליחי 30.10.2026)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = process.env.GITHUB_REPOSITORY || 'elihayb10/bcars-video';
const TAG = 'videos-sale';
const MAX = Number(process.env.MAX_RENDERS || 30); // תקרה לריצה אחת
const MIN_CREDITS = 1500;                          // פחות מזה בחשבון הקריינות: לא בונים, ומתריעים

const out = (cmd, args, opt = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opt });
const run = (cmd, args, opt = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opt });
const url = (tag, name) => `https://github.com/${REPO}/releases/download/${tag}/${name}`;
const fails = [];

function release(tag, title) {
  try { out('gh', ['release', 'view', tag, '-R', REPO, '--json', 'tagName']); }
  catch { run('gh', ['release', 'create', tag, '-R', REPO, '--title', title, '--notes', 'נוצר אוטומטית ע"י pipeline.mjs', '--latest=false']); }
  return JSON.parse(out('gh', ['release', 'view', tag, '-R', REPO, '--json', 'assets'])).assets.map((a) => a.name);
}

// 1. נתונים
fs.rmSync('data', { recursive: true, force: true });
fs.mkdirSync('data');
run('node', ['../video_data.cjs', 'collect', '--direct'], { cwd: 'data' });
const cars = JSON.parse(fs.readFileSync('data/cars.json', 'utf8'));

// 2. המלאי בלי מחירים, לאישור מכירה במכונה בענן
release('data', 'נתוני מלאי');
if (Array.isArray(cars.apiPlates)) {
  run('node', ['../video_data.cjs', 'stock', 'stock.json'], { cwd: 'data' });
  run('gh', ['release', 'upload', 'data', 'data/stock.json', '-R', REPO, '--clobber']);
} else console.log('auto360 לא זמין: ' + cars.apiWhy);

// 3. משימות (בתיקיית data, שלא נשמרת במאגר)
run('node', ['../video_data.cjs', 'sale-jobs-all', 'sale-jobs'], { cwd: 'data' });
const list = JSON.parse(fs.readFileSync('data/sale-jobs/_list.json', 'utf8'));
// רכבים שהמודעה שלהם קרוסלה לא צריכים סרטון (חוסך קרדיטים). רכב חדש מקבל סרטון תמיד, והמכונה מחליטה על הפורמט
const carousel = new Set(fs.existsSync('carousel-plates.json') ? JSON.parse(fs.readFileSync('carousel-plates.json', 'utf8')) : []);
const man = fs.existsSync('videos-sale.json') ? JSON.parse(fs.readFileSync('videos-sale.json', 'utf8')) : { videos: {} };
const inStock = new Set(list.map((x) => x.plate));
const had = Object.keys(man.videos);
const gone = had.filter((p) => !inStock.has(p) && !cars.cars.some((c) => c.plate === p));
// הגנה מתקלה באתר: אם נעלמו יותר מ-20% בבת אחת, לא מוחקים כלום
const safe = gone.length <= Math.max(3, had.length * 0.2);
if (!safe) fails.push(`${gone.length} רכבים נעלמו בבת אחת. לא נמחק כלום, לבדוק את האתר`);

// 4. בנייה של מה שחדש או שהשתנה. החדשים במלאי קודם
let assets = release(TAG, 'סרטוני NOVEMBER SALE');
let credits = Infinity;
try {
  const s = await (await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } })).json();
  credits = s.character_limit - s.character_count;
  console.log(`קרדיטים לקריינות: ${credits}`);
} catch (e) { console.log('לא נבדקו הקרדיטים: ' + e.message); }
let built = 0;
for (const { plate, sig, name } of [...list].sort((a, b) => a.ageDays - b.ageDays)) {
  const cur = man.videos[plate];
  if (cur && cur.sig === sig && assets.includes(cur.file)) continue;
  if (carousel.has(plate)) continue;
  if (built >= MAX) { console.log(`נדחה לריצה הבאה: ${plate}`); continue; }
  const job = JSON.parse(fs.readFileSync(`data/sale-jobs/${plate}.json`, 'utf8'));
  const need = job.segs.reduce((t, g) => t + (g.say || '').length, 0);
  if (credits - need < MIN_CREDITS) { fails.push(`נגמרים הקרדיטים לקריינות (${credits}). ${name} לא נבנה`); break; }
  const file = `${plate}-${sig}.mp4`;
  try {
    run('node', ['render.mjs', `data/sale-jobs/${plate}.json`, `out/${file}`]);
    run('gh', ['release', 'upload', TAG, `out/${file}`, '-R', REPO, '--clobber']);
    if (cur && cur.file !== file && assets.includes(cur.file)) run('gh', ['release', 'delete-asset', TAG, cur.file, '-R', REPO, '--yes']);
    man.videos[plate] = { sig, file, url: url(TAG, file), name, at: new Date().toISOString() };
    built++; credits -= need;
  } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`); }
}

// 5. רכב שנמכר: הסרטון נמחק
assets = release(TAG, 'סרטוני NOVEMBER SALE');
if (safe) for (const plate of gone) {
  const f = man.videos[plate].file;
  if (assets.includes(f)) run('gh', ['release', 'delete-asset', TAG, f, '-R', REPO, '--yes']);
  delete man.videos[plate];
  console.log(`נמחק (ירד מהמלאי): ${plate}`);
}

// 6. הרשימה
man.updated = new Date().toISOString();
man.count = Object.keys(man.videos).length;
man.videos = Object.fromEntries(Object.entries(man.videos).sort());
fs.writeFileSync('videos-sale.json', JSON.stringify(man, null, 1) + '\n');
console.log(`נבנו ${built}. במלאי ${list.length} עם מחיר פרסום, עם סרטון ${man.count}.`);

run('git', ['add', 'videos-sale.json']);
try { out('git', ['diff', '--cached', '--quiet']); console.log('אין שינוי לשמירה'); }
catch {
  run('git', ['-c', 'user.name=bcars-video-bot', '-c', 'user.email=bcars-video-bot@users.noreply.github.com', 'commit', '-q', '-m', `videos-sale: ${built} built, ${man.count} in stock`]);
  run('git', ['pull', '-q', '--rebase']);
  run('git', ['push', '-q']);
}
if (fails.length) { console.log('::error::' + fails.join(' | ')); process.exit(1); }
