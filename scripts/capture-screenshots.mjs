/**
 * Render scripts/screenshots.html to the three marketplace listing images.
 *
 * These used to be captured by hand, which is how the numbered pins ended up in
 * a published image with the legend explaining them cropped away. Each `.frame`
 * carries its own caption, mock and notes; capturing the element rather than a
 * hand-drawn region means the three cannot be separated again.
 *
 *   npm i playwright-core          # once, anywhere on NODE_PATH
 *   node scripts/capture-screenshots.mjs [--only sidebar]
 *
 * Point PLAYWRIGHT_CORE at the package directory if it is not already
 * resolvable, and CHROME at a browser binary if playwright cannot find one.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, '.product', 'public');

// 1.5 keeps the published width at 1920 for a 1280 CSS frame, which is what the
// listing has always shipped.
const SCALE = 1.5;

const SHOTS = [
  { id: 'shot-sidebar', file: '01-profiles.png' },
  { id: 'shot-editor', file: '02-editor.png' },
  { id: 'shot-columns', file: '03-columns.png' },
];

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]
  : null;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serve() {
  const server = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const path = join(ROOT, rel);
    createReadStream(path)
      .on('open', () => res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }))
      .on('error', () => { res.writeHead(404).end(); })
      .pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const { server, port } = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1200 },
    deviceScaleFactor: SCALE,
  });
  await page.goto(`http://127.0.0.1:${port}/scripts/screenshots.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.fonts.status === 'loaded');

  for (const { id, file } of SHOTS) {
    if (only && !id.includes(only)) continue;
    const frame = page.locator(`#${id}`);

    // A pin whose target selector matched nothing is hidden by the placement
    // pass rather than left at the frame origin. Silently shipping an image
    // with a missing marker is worse than failing here.
    const missing = await frame.evaluate((el) =>
      [...el.querySelectorAll('.pin[data-target]')]
        .filter((p) => p.style.display === 'none')
        .map((p) => `${p.textContent.trim()} -> ${p.dataset.target}`));
    if (missing.length) {
      throw new Error(`${id}: pin target did not match: ${missing.join(', ')}`);
    }

    // Every pin needs the note that explains it, and vice versa.
    const [pins, notes] = await frame.evaluate((el) => [
      el.querySelectorAll('.pin').length,
      el.querySelectorAll('.note').length,
    ]);
    if (pins !== notes) {
      throw new Error(`${id}: ${pins} pins but ${notes} notes`);
    }

    // A column painting over its neighbour is invisible in the markup and
    // obvious in the image: PORTS vanished under CHAT in a published listing
    // this way, because the tab row measured wider than the column holding it.
    const spill = await frame.evaluate((el) =>
      [...el.querySelectorAll('.pane, .term, .aux, .sidebar')]
        .filter((c) => c.scrollWidth > c.clientWidth + 1)
        .map((c) => `${c.className} needs ${c.scrollWidth}px in ${c.clientWidth}px`));
    if (spill.length) {
      throw new Error(`${id}: column overflows: ${spill.join('; ')}`);
    }

    // The no-em-dash rule covers anything a user reads, and a listing image is
    // read more often than the README. Unicode arrows go with it: these are
    // rendered pictures of text, so nothing downstream can catch them.
    const bad = await frame.evaluate((el) => {
      const found = new Set();
      for (const m of (el.innerText || '').matchAll(/[—–←-⇿…]/g)) found.add(m[0]);
      return [...found];
    });
    if (bad.length) {
      throw new Error(`${id}: banned characters in rendered text: ${bad.map((c) => JSON.stringify(c)).join(', ')}`);
    }

    const path = join(OUT, file);
    await frame.screenshot({ path });
    const { size } = await stat(path);
    const box = await frame.boundingBox();
    console.log(
      `wrote ${file} (${Math.round(box.width * SCALE)}x${Math.round(box.height * SCALE)}, ` +
      `${(size / 1024).toFixed(0)} KB, ${pins} pins)`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
