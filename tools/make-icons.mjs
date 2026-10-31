// Generates icons/16.png .. icons/128.png by rasterising the SVG sources in
// icons/src with Playwright's bundled Chromium: mascot.svg for 48/128,
// mascot-small.svg (bolder strokes, fewer details) for 16/32. Transparent
// background, exact pixel size (SVG rendered at width/height = size,
// deviceScaleFactor 1). Run: npm run make:icons

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SOURCES = [
  { file: 'mascot.svg', sizes: [128, 48] },
  { file: 'mascot-small.svg', sizes: [32, 16] },
];

const dataUrl = async (file) =>
  `data:image/svg+xml;base64,${(await readFile(path.join(ROOT, 'icons/src', file))).toString('base64')}`;

let browser;
try {
  browser = await chromium.launch();
} catch {
  // headless-shell flavour missing; the bundled full Chromium works too
  browser = await chromium.launch({ channel: 'chromium' });
}
const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
await mkdir(path.join(ROOT, 'icons'), { recursive: true });

for (const { file, sizes } of SOURCES) {
  const url = await dataUrl(file);
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0"><img src="${url}" width="${size}" height="${size}" style="display:block"></body>`,
    );
    await page.locator('img').evaluate((el) => el.decode().catch(() => {}));
    const png = await page.locator('img').screenshot({ omitBackground: true });
    await writeFile(path.join(ROOT, 'icons', `${size}.png`), png);
    console.log(`icons/${size}.png  (${size}x${size} from icons/src/${file})`);
  }
}
await browser.close();
