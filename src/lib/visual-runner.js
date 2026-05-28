import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { ensureDir, writeJson, writeText } from './store.js';

export const VISUAL_VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 1000 },
  { id: 'tablet', width: 834, height: 1112 },
  { id: 'mobile', width: 390, height: 844 },
];

export async function renderVisualArtifact({
  content,
  outputDir,
  artifactName = 'artifact',
  viewports = VISUAL_VIEWPORTS,
}) {
  const startedAt = Date.now();
  await ensureDir(outputDir);
  const html = extractHtmlDocument(content);
  const artifactPath = path.join(outputDir, `${sanitizeName(artifactName)}.html`);
  const renderJsonPath = path.join(outputDir, 'render.json');
  const consoleMessages = [];
  const pageErrors = [];
  const requestFailures = [];
  const screenshots = [];

  await writeText(artifactPath, html || diagnosticHtml(content));
  if (!html) {
    const result = {
      status: 'failed',
      artifactPath,
      screenshots,
      consoleMessages,
      pageErrors,
      requestFailures,
      elapsedMs: Date.now() - startedAt,
      blankScreenDetected: false,
      error: {
        name: 'InvalidVisualArtifact',
        message: 'Generated output did not contain a browser-renderable HTML artifact.',
      },
    };
    await writeJson(renderJsonPath, result);
    return result;
  }

  let browser = null;
  try {
    browser = await launchChromium();
    const context = await browser.newContext();

    for (const viewport of viewports) {
      const page = await context.newPage();
      page.on('console', message => {
        if (['error', 'warning'].includes(message.type())) {
          consoleMessages.push({
            viewport: viewport.id,
            type: message.type(),
            text: message.text(),
          });
        }
      });
      page.on('pageerror', error => {
        pageErrors.push({
          viewport: viewport.id,
          name: error.name || 'Error',
          message: error.message,
        });
      });
      page.on('requestfailed', request => {
        requestFailures.push({
          viewport: viewport.id,
          url: request.url(),
          failure: request.failure()?.errorText || 'request failed',
        });
      });

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(pathToFileURL(artifactPath).href, { waitUntil: 'networkidle', timeout: 10000 });
      const screenshotPath = path.join(outputDir, `${viewport.id}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const blank = await detectBlankPage(page);
      screenshots.push({
        viewport: viewport.id,
        width: viewport.width,
        height: viewport.height,
        path: screenshotPath,
        blank,
      });
      await page.close();
    }

    await context.close();
    const result = {
      status: screenshots.some(item => item.blank) ? 'warning' : 'complete',
      artifactPath,
      screenshots,
      consoleMessages,
      pageErrors,
      requestFailures,
      elapsedMs: Date.now() - startedAt,
      blankScreenDetected: screenshots.some(item => item.blank),
      error: null,
    };
    await writeJson(renderJsonPath, result);
    return result;
  } catch (error) {
    const result = {
      status: 'failed',
      artifactPath,
      screenshots,
      consoleMessages,
      pageErrors,
      requestFailures,
      elapsedMs: Date.now() - startedAt,
      blankScreenDetected: screenshots.some(item => item.blank),
      error: {
        name: error.name || 'Error',
        message: error.message,
      },
    };
    await writeJson(renderJsonPath, result);
    return result;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function checkVisualRunnerAvailability() {
  try {
    const { browser, source } = await launchChromiumWithSource();
    await browser.close();
    return {
      available: true,
      browser: source,
      error: null,
      installHint: null,
    };
  } catch (error) {
    return {
      available: false,
      browser: null,
      error: error.message,
      installHint: 'Run `npx playwright install chromium`, or install Google Chrome/Chromium locally.',
    };
  }
}

async function launchChromium() {
  return (await launchChromiumWithSource()).browser;
}

async function launchChromiumWithSource() {
  try {
    return {
      browser: await chromium.launch(),
      source: 'playwright_chromium',
    };
  } catch (error) {
    const executablePath = findSystemChromium();
    if (!executablePath) throw error;
    return {
      browser: await chromium.launch({ executablePath }),
      source: 'system_chromium',
    };
  }
}

export function findSystemChromium() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ];
  return candidates.find(candidate => fsSync.existsSync(candidate)) || null;
}

export function extractHtmlDocument(content = '') {
  const text = String(content || '').trim();
  const fencedHtml = text.match(/```html\s*([\s\S]*?)```/i);
  if (fencedHtml) return normalizeHtml(fencedHtml[1]);
  const fencedGeneric = text.match(/```\s*([\s\S]*?<html[\s\S]*?)```/i);
  if (fencedGeneric) return normalizeHtml(fencedGeneric[1]);
  const doc = text.match(/<!doctype html[\s\S]*$/i) || text.match(/<html[\s\S]*<\/html>/i);
  if (doc) return normalizeHtml(doc[0]);
  if (/<(?:main|section|div|style|script|body)\b/i.test(text)) return normalizeHtml(text);
  return null;
}

async function detectBlankPage(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText?.trim() || '';
    const elementCount = document.body?.querySelectorAll('*').length || 0;
    const visibleElements = [...document.body.querySelectorAll('*')].filter(element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 2
        && rect.height > 2;
    }).length;
    return bodyText.length < 8 && elementCount < 4 && visibleElements < 2;
  });
}

function normalizeHtml(html) {
  const text = String(html || '').trim();
  if (/<!doctype html/i.test(text) || /<html[\s>]/i.test(text)) return text;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Skill RSI Visual Artifact</title>',
    '</head>',
    '<body>',
    text,
    '</body>',
    '</html>',
  ].join('\n');
}

function sanitizeName(value) {
  return String(value || 'artifact').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function diagnosticHtml(content) {
  return normalizeHtml(`<main><h1>Invalid visual artifact</h1><pre>${escapeHtml(content)}</pre></main>`);
}

export async function imageFileToDataUrl(filePath) {
  const bytes = await fs.readFile(filePath);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
