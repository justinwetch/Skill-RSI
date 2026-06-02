#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { findSystemChromium } from '../src/lib/visual-runner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'docs/assets/diagrams/source/index.html');
const outputDir = path.join(root, 'docs/assets/diagrams/png');
const manifestPath = path.join(root, 'docs/assets/diagrams/manifest.generated.json');

const sizes = {
  wide: { width: 1600, height: 900 },
  square: { width: 1200, height: 1200 },
};

await fs.mkdir(outputDir, { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: sizes.wide, deviceScaleFactor: 1 });
const sourceUrl = pathToFileURL(sourcePath).href;

await page.goto(sourceUrl, { waitUntil: 'load' });
const diagrams = await page.evaluate(() => window.SKILL_RSI_DIAGRAMS || []);

if (!diagrams.length) {
  throw new Error('No diagrams found in source page.');
}

const exported = [];

for (const diagram of diagrams) {
  for (const [format, viewport] of Object.entries(sizes)) {
    const outputFile = `${diagram.slug}-${format}.png`;
    const outputPath = path.join(outputDir, outputFile);
    await page.setViewportSize(viewport);
    await page.goto(`${sourceUrl}?diagram=${encodeURIComponent(diagram.slug)}&format=${format}`, { waitUntil: 'load' });
    await page.waitForSelector(`[data-diagram="${diagram.slug}"]`);

    const diagnostic = await page.evaluate(slug => {
      const frame = document.querySelector(`[data-diagram="${slug}"]`);
      const rect = frame?.getBoundingClientRect();
      const text = frame?.textContent?.replace(/\s+/g, ' ').trim() || '';
      return {
        exists: Boolean(frame),
        width: rect?.width || 0,
        height: rect?.height || 0,
        textLength: text.length,
      };
    }, diagram.slug);

    if (!diagnostic.exists || diagnostic.width < viewport.width * 0.95 || diagnostic.height < viewport.height * 0.95 || diagnostic.textLength < 80) {
      throw new Error(`Diagram ${diagram.slug} ${format} failed render diagnostics: ${JSON.stringify(diagnostic)}`);
    }

    await page.screenshot({ path: outputPath, fullPage: false });
    exported.push({
      ...diagram,
      format,
      width: viewport.width,
      height: viewport.height,
      file: `png/${outputFile}`,
    });
    console.log(`rendered ${outputFile}`);
  }
}

await browser.close();

await fs.writeFile(manifestPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'docs/assets/diagrams/source/index.html',
  exports: exported,
}, null, 2)}\n`);

console.log(`wrote ${path.relative(root, manifestPath)}`);

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    const executablePath = findSystemChromium();
    if (!executablePath) throw error;
    return chromium.launch({ executablePath });
  }
}
