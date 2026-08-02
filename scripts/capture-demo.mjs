/**
 * Render scripts/demo.html to the demo clips.
 *
 * Frames are grabbed one at a time from a frozen clock rather than recorded in
 * real time: `__seek(t)` sets the whole frame, so the grabber can take as long
 * as it likes per frame and the output is identical every run. Recording a live
 * page would tear and drop frames under screenshot load.
 *
 * Working files land in .product/video (gitignored); the finished clips land in
 * .product/public (committed, because the README and the marketplace listing
 * resolve them from the default branch).
 *
 *   npm i playwright-core          # once, anywhere on NODE_PATH
 *   node scripts/capture-demo.mjs [--fps 30] [--only profiles]
 */
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Resolved rather than imported, so playwright-core can live outside the repo.
// It is a build-time tool for one script, not something the extension needs, and
// this project deliberately keeps its own dependency list to plain tsc.
// Point PLAYWRIGHT_CORE at the package directory if it is not already resolvable.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const run = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORK = join(ROOT, '.product', 'video');
// Video output lives under .product/video, which is gitignored. .product/public
// is for the small listing images the README references and nothing else.
const OUT = join(ROOT, '.product', 'video', 'out');

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const FPS = Number(arg('fps', 30));
const ONLY = arg('only', null);
// The stage is authored at 1280x720 CSS pixels. Rendering at a device scale
// factor multiplies the raster without touching layout, so 1.5 gives a true
// 1920x1080 with text rasterised at that size rather than an upscale of 720p.
const SCALE = Number(arg('scale', 1.5));
const W = 1280, H = 720;

/** Chromium from the Playwright cache; no browser download needed. */
function findChromium() {
  const base = join(process.env.HOME ?? '', '.cache', 'ms-playwright');
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base).filter((d) => d.startsWith('chromium-'));
  for (const d of dirs.sort().reverse()) {
    const exe = join(base, d, 'chrome-linux', 'chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

async function ffmpeg(args) {
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  } catch (error) {
    console.error('  ffmpeg failed:', error.stderr?.slice(0, 400) ?? error.message);
    throw error;
  }
}

/**
 * Encode one scene.
 *
 * ProRes 422 HQ because an NLE scrubs intraframe without transcoding and it
 * survives the re-encode when a music bed is added. The H.264 alongside it is
 * for review and for uploading unedited. A short fade at each end means the
 * scenes concatenate into the full cut with a natural dip instead of a hard
 * jump between two different layouts.
 */
async function encodeScene(framesDir, name, seconds) {
  const pattern = join(framesDir, '%05d.png');
  // No fade filter: the storyboard pixelates its own scene edges, so ffmpeg
  // adding a dip to black on top would read as two transitions at every cut.
  const pro = join(WORK, 'scenes', `${name}.mov`);
  await ffmpeg(['-framerate', String(FPS), '-i', pattern,
    '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', pro]);
  await ffmpeg(['-framerate', String(FPS), '-i', pattern,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-movflags', '+faststart', join(OUT, 'scenes', `${name}.mp4`)]);
  return pro;
}

const mb = async (f) => `${((await stat(f)).size / 1048576).toFixed(1)} MB`;

async function capture(page, scene, seconds, name) {
  const dir = join(WORK, 'frames', name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const total = Math.round(seconds * FPS);
  for (let i = 0; i < total; i++) {
    await page.evaluate(([time, s]) => window.__seek(time, s), [i / FPS, scene]);
    await page.screenshot({ path: join(dir, String(i).padStart(5, '0') + '.png') });
    if (i % 90 === 0) process.stdout.write(`\r  ${name}: ${i}/${total}`);
  }
  process.stdout.write(`\r  ${name}: ${total} frames        \n`);
  return dir;
}

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
await page.goto('file://' + join(ROOT, 'scripts', 'demo.html'));
await page.waitForFunction(() => typeof window.__seek === 'function');
const scenes = await page.evaluate(() => window.__scenes);
for (const d of [join(OUT, 'scenes'), join(WORK, 'scenes')]) await mkdir(d, { recursive: true });

console.log(`${W * SCALE}x${H * SCALE} @ ${FPS}fps  ${scenes.reduce((n, s) => n + s.len, 0)}s across ${scenes.length} scenes\n`);
const masters = [];
for (const s of scenes) {
  if (ONLY && s.id !== ONLY) continue;
  const name = `${String(scenes.indexOf(s) + 1).padStart(2, '0')}-${s.id}`;
  const dir = await capture(page, s.id, s.len, name);
  masters.push(await encodeScene(dir, name, s.len));
  await rm(dir, { recursive: true, force: true });   // frames are large; the masters are the artefact
}
await browser.close();

if (!ONLY) {
  // Stream-copy concat: every scene shares codec and geometry, so no re-encode
  // and therefore no generation loss in the assembled master.
  const list = join(WORK, 'concat.txt');
  await writeFile(list, masters.map((f) => `file '${f}'`).join('\n'));
  const fullPro = join(OUT, 'demo-1080p-master.mov');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', fullPro]);
  const fullMp4 = join(OUT, 'demo-1080p.mp4');
  await ffmpeg(['-i', fullPro, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    '-preset', 'slow', '-movflags', '+faststart', fullMp4]);
  console.log(`\n  master  ${await mb(fullPro)}  ${fullPro.split('/').pop()}`);
  console.log(`  upload  ${await mb(fullMp4)}  ${fullMp4.split('/').pop()}`);
}
console.log('\nScene files in .product/video/out/scenes, ProRes intermediates in .product/video/scenes.');
