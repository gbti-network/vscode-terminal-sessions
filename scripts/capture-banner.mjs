/**
 * Render scripts/banner.html to .product/branding/banner.webp.
 *
 * Not .product/public/, which is only for images the README links to. The
 * README does not carry a banner; this one is for surfaces outside the
 * repository, such as the GitHub social preview, which is an upload rather
 * than a committed file.
 *
 * The page is captured at twice its finished size and downscaled, so type is
 * rasterised at 2x rather than a 1x raster being stretched. `#2x` in the URL is
 * what switches the page into that mode.
 *
 * Same shape as capture-demo.mjs, and for the same reason: playwright-core is a
 * build-time tool for one script, not something the extension needs, so this
 * project keeps its own dependency list at plain tsc and resolves the browser
 * from wherever it already lives.
 *
 *   npm i playwright-core          # once, anywhere on NODE_PATH
 *   node scripts/capture-banner.mjs
 *
 * Point PLAYWRIGHT_CORE at the package directory if it is not already
 * resolvable, and CHROME at a browser binary if playwright cannot find one.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const run = promisify(execFile);

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, '.product', 'branding', 'banner.webp');
const W = 1500;
const H = 500;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Served over http rather than opened as file://, because Chromium refuses
// font subresources on a file:// page and the banner is mostly type.
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
  const page = await browser.newPage({ viewport: { width: W * 2, height: H * 2 } });
  await page.goto(`http://127.0.0.1:${port}/scripts/banner.html#2x`, { waitUntil: 'load' });

  // The page sets this once document.fonts.ready resolves. Capturing before
  // then catches fallback metrics, which is a defect no amount of reading the
  // source would show.
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');

  await mkdir(dirname(OUT), { recursive: true });
  const png = join(dirname(OUT), '.banner-2x.png');
  await page.screenshot({ path: png });

  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', png,
    '-vf', `scale=${W}:${H}:flags=lanczos`,
    '-lossless', '0', '-quality', '92',
    OUT,
  ]);
  await unlink(png);

  const { size } = await stat(OUT);
  console.log(`wrote ${OUT} (${W}x${H}, ${(size / 1024).toFixed(1)} KB)`);
} finally {
  await browser.close();
  server.close();
}
