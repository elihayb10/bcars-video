// בונה סרטון מודעה לרכב אחד מתוך משימה: node render.mjs jobs/<plate>.json
// המשימה נכתבת ע"י מכונת המלאי (bcars_ads.js) מנתוני האתר: מה נאמר ומה כתוב על המסך. כאן אין החלטה על תוכן, רק בנייה.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VOICE = 'k77ZRVqAFg9Hd0ltAuON'; // עומר (ElevenLabs), כמו בסרטוני המבצעים (החלטה #96)
const MODEL = 'eleven_v4';            // בלי האצה (#96)
const END_CARD = 2.8;                 // שניות של כרטיס הסיום

const jobFile = process.argv[2];
if (!jobFile) throw new Error('usage: node render.mjs jobs/<plate>.json');
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
const root = path.dirname(fileURLToPath(import.meta.url));
const work = path.join(root, 'work', job.plate);
fs.rmSync(work, { recursive: true, force: true });
fs.cpSync(path.join(root, 'template'), work, { recursive: true });
for (const d of ['assets/cars', 'build/vo', 'lib']) fs.mkdirSync(path.join(work, d), { recursive: true });
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

async function fetchOk(url, opts, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try { const r = await fetch(url, opts); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200)); return r; }
    catch (e) { if (i === tries) throw new Error(url.split('?')[0] + ': ' + e.message); await new Promise((s) => setTimeout(s, 3000 * i)); }
  }
}
const download = async (url, file) => fs.writeFileSync(file, Buffer.from(await (await fetchOk(url)).arrayBuffer()));

// 1. התמונות: 10, בסדר של האתר, בלי שום עיבוד
if (job.images.length !== 10) throw new Error('צריך בדיוק 10 תמונות');
await Promise.all(job.images.map((u, i) => download(u, path.join(work, 'assets/cars', `${job.plate}-${String(i + 1).padStart(2, '0')}.jpg`))));

// 2. הקריין: משפט אחד לכל כתובית, עם ההקשר של המשפט הקודם והבא כדי שיישמע רציף
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error('חסר ELEVENLABS_API_KEY');
const segs = job.segs;
const spoken = segs.filter((g) => g.say);
for (const [i, g] of segs.entries()) {
  // כתובית שקטה (בלי קריין): מוצגת זמן קבוע, המוזיקה ממלאת
  if (!g.say) { g.lead = 0; g.len = g.hold || 1.6; continue; }
  const body = { text: g.say, model_id: MODEL, language_code: 'he' };
  const k = spoken.indexOf(g);
  if (k > 0) body.previous_text = spoken[k - 1].say;
  if (k < spoken.length - 1) body.next_text = spoken[k + 1].say;
  const r = await fetchOk(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`,
    { method: 'POST', headers: { 'xi-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  const f = path.join(work, 'build/vo', `${i}.mp3`);
  fs.writeFileSync(f, Buffer.from(j.audio_base64, 'base64'));
  const a = j.alignment, first = a.character_start_times_seconds.find((t, k) => a.characters[k].trim()) || 0;
  g.lead = Math.max(0, first - 0.03);                       // שקט בתחילת הקובץ: מדלגים עליו
  g.len = a.character_end_times_seconds.at(-1) - g.lead + 0.05;
}

// 3. ציר הזמן: הכתוביות לפי הקול, השלבים לפי המשפטים, כרטיס הסיום בסוף
let t = 0.12;
for (const [i, g] of segs.entries()) {
  if (i > 0 && g.beat !== segs[i - 1].beat) t += 0.18;     // נשימה קטנה בין שלבים
  g.s = +t.toFixed(3); g.e = +(t + g.len).toFixed(3); t = g.e + 0.1;
}
const lastSpoken = segs.filter((g) => g.beat < 5).at(-1);
const endAt = +(lastSpoken.e + 0.25).toFixed(3);
// משפט הסיום (שלב 5) נאמר על כרטיס הסיום
let te = endAt + 0.3; for (const g of segs.filter((x) => x.beat === 5)) { g.s = +te.toFixed(3); g.e = +(te + g.len).toFixed(3); te = g.e + 0.1; }
const total = +Math.max(endAt + END_CARD, te + 0.6).toFixed(2);
const range = (b) => { const x = segs.filter((g) => g.beat === b); return x.length ? [x[0].s, x.at(-1).e + 0.1] : null; };
const b1 = range(1);
if (!b1) throw new Error('חסר שלב פתיח');
// 10 התמונות אחת אחרי השנייה, כל אחת פעם אחת, בחלוקה שווה. כל חיתוך "נתפס" למעבר כתובית קרוב (עד 0.45 שנ') כדי שתמונה חדשה תגיע עם פרט חדש
const cuts = [0];
for (let k = 1; k < 10; k++) {
  const ideal = endAt * k / 10, near = segs.filter((g) => g.beat < 5).map((g) => g.s).sort((x, y) => Math.abs(x - ideal) - Math.abs(y - ideal))[0];
  let c = near != null && Math.abs(near - ideal) <= 0.45 ? near : ideal;
  if (c - cuts.at(-1) < 0.9) c = ideal;
  cuts.push(+c.toFixed(3));
}
cuts.push(endAt);
const photos = Array.from({ length: 10 }, (_, k) => ({ n: k + 1, s: cuts[k], e: cuts[k + 1] }));
const TL = { total, end: endAt, segs: segs.filter((g) => g.beat < 5).map((g) => ({ show: g.show, s: g.s, e: g.e })), photos };

// 4. הסאונד: הקריין במקום, המוזיקה מתחתיו (מתכווצת כשמדברים), עוצמה אחידה
await download(job.music.url, path.join(work, 'build/music.mp3'));
const inputs = [], delays = [];
segs.forEach((g, i) => {
  if (!g.say) return;
  const n = delays.length;
  inputs.push('-ss', String(g.lead), '-t', String(g.len), '-i', path.join(work, 'build/vo', `${i}.mp3`));
  delays.push(`[${n}:a]adelay=${Math.round(g.s * 1000)}:all=1[v${n}]`);
});
const m = delays.length;
inputs.push('-ss', String(job.music.start || 0), '-t', String(total), '-i', path.join(work, 'build/music.mp3'));
const filter = [
  ...delays,
  `${delays.map((_, i) => `[v${i}]`).join('')}amix=inputs=${m}:normalize=0,apad=whole_dur=${total}[vo]`,
  `[vo]asplit=2[vo1][vo2]`,
  `[${m}:a]volume=0.55,afade=t=in:d=0.2,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2[mu]`,
  `[mu][vo1]sidechaincompress=threshold=0.03:ratio=9:attack=15:release=350[duck]`,
  `[vo2][duck]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5,atrim=0:${total}[out]`,
].join(';');
ff(...inputs, '-filter_complex', filter, '-map', '[out]', '-ar', '48000', '-ac', '2', path.join(work, 'build/mix.wav'));

// 5. התבנית: GSAP מקומי (הענן חוסם CDN), הנתונים, ציר הזמן והמשך
fs.copyFileSync(path.join(root, 'node_modules/gsap/dist/gsap.min.js'), path.join(work, 'lib/gsap.min.js'));
let html = fs.readFileSync(path.join(work, 'index.html'), 'utf8');
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"]+"><\/script>/, '<script src="lib/gsap.min.js"></script>');
const mark = (k) => new RegExp(`\\/\\*${k}\\*\\/[\\s\\S]*?\\/\\*${k}\\*\\/`);
for (const k of ['DATA', 'TL']) if (!mark(k).test(html)) throw new Error(`לא נמצא סימון ${k} בתבנית`);
html = html.replace(mark('DATA'), () => `/*DATA*/${JSON.stringify(job.data)}/*DATA*/`).replace(mark('TL'), () => `/*TL*/${JSON.stringify(TL)}/*TL*/`);
html = html.replace(/data-duration="18"/g, `data-duration="${total}"`);
fs.writeFileSync(path.join(work, 'index.html'), html);
fs.writeFileSync(path.join(work, 'build/timeline.json'), JSON.stringify({ TL, segs }, null, 1));

const out = path.join(root, 'videos', `${job.plate}.mp4`);
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync('npx', ['--yes', 'hyperframes@0.8.157', 'render', '-o', out], { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' });

// 6. בדיקה של התוצאה
const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', out]).toString());
const v = p.streams.find((s) => s.codec_type === 'video'), au = p.streams.find((s) => s.codec_type === 'audio');
if (!v || v.width !== 1080 || v.height !== 1920) throw new Error('גודל שגוי');
if (!au) throw new Error('אין סאונד');
if (Math.abs(dur(out) - total) > 0.5) throw new Error(`משך שגוי: ${dur(out)} במקום ${total}`);
console.log(`OK ${job.plate} ${total}s · ${segs.length} משפטים`);
