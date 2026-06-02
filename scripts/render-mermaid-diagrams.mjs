#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { findSystemChromium } from '../src/lib/visual-runner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'docs/assets/diagrams/mermaid');
const svgDir = path.join(root, 'docs/assets/diagrams/mermaid-svg');
const pngDir = path.join(root, 'docs/assets/diagrams/mermaid-png');
const manifestPath = path.join(root, 'docs/assets/diagrams/mermaid-manifest.generated.json');

const diagrams = [
  {
    slug: 'core-loop',
    title: 'The core loop',
    eyebrow: 'Controlled recursive improvement',
    lede: 'A run changes one focused surface, evaluates the challenger against the champion, then writes memory for the next loop.',
    placement: 'README How It Works anchor; blog/social overview',
  },
  {
    slug: 'ontology-map',
    title: 'Ontology map',
    eyebrow: 'Domain guardrail',
    lede: 'Research becomes a shared map of users, tasks, quality, failure modes, and evaluation vocabulary.',
    placement: 'README intro after the ontology paragraph; social explainer',
  },
  {
    slug: 'deconstruction-map',
    title: 'Deconstruction map',
    eyebrow: 'Champion artifact analysis',
    lede: 'The current champion is mapped into testable surfaces, each carrying evidence, risk, and a measurement plan.',
    placement: 'docs/HOW_IT_WORKS deconstruction section; technical social post',
  },
  {
    slug: 'control-treatment',
    title: 'Control vs treatment',
    eyebrow: 'One variable moves',
    lede: 'The champion stays fixed while one challenger tests a focused mutation under the same prompts and criteria.',
    placement: 'README controlled-experiment explanation; social carousel',
  },
  {
    slug: 'cold-start-duel',
    title: 'Cold-start duel',
    eyebrow: 'First champion selection',
    lede: 'Scratch projects start with two independently planned candidates because there is no champion control yet.',
    placement: 'README How It Works scratch-run section',
  },
  {
    slug: 'experiment-plan',
    title: 'Experiment plan',
    eyebrow: 'Round premise',
    lede: 'The manager chooses what changes, what stays fixed, and what evidence should prove or disprove the hypothesis.',
    placement: 'README next-loop plan or UI walkthrough',
  },
  {
    slug: 'preflight-review',
    title: 'Preflight review gate',
    eyebrow: 'Before evaluation',
    lede: 'Candidates must pass package, safety, leakage, and experiment-fidelity checks before evaluation.',
    placement: 'docs/HOW_IT_WORKS preflight review section',
  },
  {
    slug: 'prompt-evidence-stack',
    title: 'Prompt-level evidence stack',
    eyebrow: 'Inspectable decisions',
    lede: 'Every promotion can point back to prompt text, candidate outputs, criterion scores, and judge rationale.',
    placement: 'README Evidence-Backed Decisions section',
  },
  {
    slug: 'promotion-policy',
    title: 'Promotion policy gate',
    eyebrow: 'Champion replacement',
    lede: 'Skill RSI blocks flashy wins that fail thresholds, regress stable prompts, or lack enough evidence.',
    placement: 'docs/HOW_IT_WORKS promotion section; social technical post',
  },
  {
    slug: 'history-memory',
    title: 'History as memory',
    eyebrow: 'Learning from dead ends',
    lede: 'Detailed artifacts and compact history make each loop better informed than the last.',
    placement: 'README history screenshot section; social proof post',
  },
  {
    slug: 'artifact-contract',
    title: 'Artifact contract',
    eyebrow: 'Evaluation stays honest',
    lede: 'The selected output type controls what prompts can ask for and what judges are allowed to score.',
    placement: 'docs/HOW_IT_WORKS project inputs/output artifact section',
  },
  {
    slug: 'operator-surfaces',
    title: 'Operator surfaces',
    eyebrow: 'Same loop, three controls',
    lede: 'The UI, CLI, and Codex plugin all operate the same underlying run loop and project store.',
    placement: 'README Codex Plugin and Local UI sections',
  },
];

const formats = {
  square: { width: 2400, height: 2400 },
};

await fs.rm(pngDir, { recursive: true, force: true });
await fs.rm(svgDir, { recursive: true, force: true });
await fs.mkdir(svgDir, { recursive: true });
await fs.mkdir(pngDir, { recursive: true });

const server = await startStaticServer(root);
const browser = await launchBrowser();
let exports = [];

try {
  const page = await browser.newPage({ viewport: formats.square, deviceScaleFactor: 1 });
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) {
      console.log(`[browser:${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', error => {
    console.log(`[browser:pageerror] ${error.name}: ${error.message}`);
  });
  page.on('requestfailed', request => {
    console.log(`[browser:requestfailed] ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  await page.goto(`${server.origin}/docs/assets/diagrams/mermaid/render.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.renderDiagram === 'function');

  for (const diagram of diagrams) {
    const sourcePath = path.join(sourceDir, `${diagram.slug}.mmd`);
    const source = await fs.readFile(sourcePath, 'utf8');
    let rawSvg = null;

    for (const [format, viewport] of Object.entries(formats)) {
      await page.setViewportSize(viewport);
      rawSvg = await page.evaluate(input => window.renderDiagram(input), {
        ...diagram,
        source,
        format,
      });
      await page.waitForSelector('#diagram svg');

      const diagnostic = await page.evaluate(() => {
        const svg = document.querySelector('#diagram svg');
        const rect = svg?.getBoundingClientRect();
        return {
          exists: Boolean(svg),
          width: rect?.width || 0,
          height: rect?.height || 0,
          textLength: document.body.innerText.length,
        };
      });

      if (!diagnostic.exists || diagnostic.width < 120 || diagnostic.height < 120 || diagnostic.textLength < 80) {
        throw new Error(`${diagram.slug} ${format} failed render diagnostics: ${JSON.stringify(diagnostic)}`);
      }

      const pngFile = `${diagram.slug}.png`;
      await page.screenshot({ path: path.join(pngDir, pngFile), fullPage: false });
      exports.push({
        ...diagram,
        format,
        width: viewport.width,
        height: viewport.height,
        png: `mermaid-png/${pngFile}`,
        svg: `mermaid-svg/${diagram.slug}.svg`,
        source: `mermaid/${diagram.slug}.mmd`,
      });
      console.log(`rendered ${pngFile}`);
    }

    if (rawSvg) {
      await fs.writeFile(path.join(svgDir, `${diagram.slug}.svg`), rawSvg);
    }
  }
} finally {
  await browser.close().catch(() => {});
  await server.close();
}

await fs.writeFile(manifestPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceDir: 'docs/assets/diagrams/mermaid',
  exports,
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

async function startStaticServer(baseDir) {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    const filePath = path.normalize(path.join(baseDir, pathname));
    if (!filePath.startsWith(baseDir)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    fsSync.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': contentType(filePath) });
      response.end(content);
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.mjs') || filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
