// הצינור בענן (GitHub Actions, פעמיים ביום): סרטון עדכני לכל רכב במלאי, בלי מחשב.
// 1. נתונים מהאתר + auto360 (bcars_ads.js, אותו סקריפט כמו המכונה)  2. משימה לכל רכב
// 3. נבנה רק מה שחדש או שהשתנה  4. נשמר בגרסה "videos" (מחוץ להיסטוריה), קובץ אחד לרכב  5. רכב שנמכר: הסרטון נמחק
// 6. videos.json: רשימת הסרטונים העדכניים, שממנה המכונה בענן מעלה למטא. 7. stock.json (גרסה "data"): המלאי בלי מחירים
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO = process.env.GITHUB_REPOSITORY || 'elihayb10/bcars-video';
const MAX = Number(process.env.MAX_RENDERS || 60); // תקרה לריצה אחת (בריצה הראשונה כל המלאי)
const MIN_CREDITS = 1500;                          // פחות מזה בחשבון הקריינות: לא בונים, ומתריעים
const RENDER_V = '2';                              // להעלות כשמשנים את אופן הבנייה, כדי לבנות הכול מחדש

const out = (cmd, args, opt = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opt });
const run = (cmd, args, opt = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opt });
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
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

// 3. משימות
run('node', ['../video_data.cjs', 'video-jobs-all', '../jobs-new'], { cwd: 'data' });
const list = JSON.parse(fs.readFileSync('jobs-new/_list.json', 'utf8'));
// הגנה מתקלה באתר: אם נעלמו יותר מ-20% מהרכבים בבת אחת, לא מוחקים כלום
const man = fs.existsSync('videos.json') ? JSON.parse(fs.readFileSync('videos.json', 'utf8')) : { videos: {} };
const had = Object.keys(man.videos);
const gone = had.filter((p) => !list.includes(p));
const safe = gone.length <= Math.max(3, had.length * 0.2);
if (!safe) fails.push(`${gone.length} רכבים נעלמו בבת אחת. לא נמחק כלום, לבדוק את האתר`);
fs.rmSync('jobs', { recursive: true, force: true });
fs.renameSync('jobs-new', 'jobs');
fs.rmSync('jobs/_list.json');

// 4. בנייה של מה שחדש או שהשתנה
let assets = release('videos', 'סרטוני מלאי');
const tpl = fs.readFileSync('template/index.html', 'utf8');
let credits = Infinity;
try {
  const s = await (await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } })).json();
  credits = s.character_limit - s.character_count;
  console.log(`קרדיטים לקריינות: ${credits}`);
} catch (e) { console.log('לא נבדקו הקרדיטים: ' + e.message); }
let built = 0;
for (const plate of list) {
  const job = fs.readFileSync(`jobs/${plate}.json`, 'utf8');
  const hash = sha(job + tpl + RENDER_V);
  const cur = man.videos[plate];
  if (cur && cur.hash === hash && assets.includes(cur.file)) continue;
  if (built >= MAX) { console.log(`נדחה לריצה הבאה: ${plate}`); continue; }
  if (credits < MIN_CREDITS) { fails.push(`נגמרים הקרדיטים לקריינות (${credits}). ${plate} לא נבנה`); break; }
  const file = `${plate}-${hash}.mp4`;
  try {
    run('node', ['render.mjs', `jobs/${plate}.json`, `out/${file}`]);
    run('gh', ['release', 'upload', 'videos', `out/${file}`, '-R', REPO, '--clobber']);
    if (cur && cur.file !== file && assets.includes(cur.file)) run('gh', ['release', 'delete-asset', 'videos', cur.file, '-R', REPO, '--yes']);
    const j = JSON.parse(job);
    man.videos[plate] = { hash, file, url: url('videos', file), name: j.data.name, at: new Date().toISOString() };
    built++; credits -= 120;
  } catch (e) { fails.push(`${plate}: ${e.message.split('\n')[0]}`); }
}

// 5. רכב שנמכר: הסרטון נמחק
assets = release('videos', 'סרטוני מלאי');
if (safe) for (const plate of gone) {
  const f = man.videos[plate].file;
  if (assets.includes(f)) run('gh', ['release', 'delete-asset', 'videos', f, '-R', REPO, '--yes']);
  delete man.videos[plate];
  console.log(`נמחק (ירד מהמלאי): ${plate}`);
}
// קבצים שאף רכב לא מפנה אליהם (שאריות מריצה שנכשלה)
const used = new Set(Object.values(man.videos).map((v) => v.file));
for (const a of assets) if (a.endsWith('.mp4') && !used.has(a)) run('gh', ['release', 'delete-asset', 'videos', a, '-R', REPO, '--yes']);

// 6. הרשימה
man.updated = new Date().toISOString();
man.count = Object.keys(man.videos).length;
man.videos = Object.fromEntries(Object.entries(man.videos).sort());
fs.writeFileSync('videos.json', JSON.stringify(man, null, 1) + '\n');
console.log(`נבנו ${built}. במלאי ${list.length}, עם סרטון ${man.count}.`);

run('git', ['add', '-A', 'jobs', 'videos.json']);
try { out('git', ['diff', '--cached', '--quiet']); console.log('אין שינוי לשמירה'); }
catch {
  run('git', ['-c', 'user.name=bcars-video-bot', '-c', 'user.email=bcars-video-bot@users.noreply.github.com', 'commit', '-q', '-m', `videos: ${built} built, ${man.count} in stock`]);
  run('git', ['pull', '-q', '--rebase']);
  run('git', ['push', '-q']);
}
if (fails.length) { console.log('::error::' + fails.join(' | ')); process.exit(1); }
