#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createDemoSnapshot } from '../plugin/lib/demo.mjs';
import { createOfficeDemoFrames } from '../plugin/lib/office-demo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readWeb = name => readFile(resolve(root, 'plugin/web', name), 'utf8');
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
const safeScript = value => value.replace(/<\/script/gi, '<\\/script');
const safeStyle = value => value.replace(/<\/style/gi, '<\\/style');
await mkdir(resolve(root, 'artifacts'), { recursive: true });
const [html, css, app] = await Promise.all([readWeb('index.html'), readWeb('styles.css'), readWeb('app.js')]);
const preview = html
  .replace('<link rel="stylesheet" href="./styles.css">', () => `<style>${safeStyle(css)}</style>`)
  .replace('  <script src="./app.js" defer></script>\n', '')
  .replace('class="brand" href="./"', 'class="brand" href="#overview"')
  .replace('</body>', () => `<script>window.__AGENT_OBSERVATORY_SNAPSHOT__=${safeJSON(createDemoSnapshot())};</script>\n<script>${safeScript(app)}</script>\n</body>`);
if (preview.includes('src="./app.js"') || preview.includes('href="./styles.css"')) throw new Error('External asset reference survived preview build');
const output = resolve(root, 'artifacts/agent-observatory-preview.html');
await writeFile(output, preview, 'utf8');

const [officeHTML, officeCSS, officeApp, officeModel, scene] = await Promise.all([
  readWeb('office.html'), readWeb('office.css'), readWeb('office.js'), readWeb('office-model.mjs'), readWeb('office-scene.svg'),
]);
const modelInline = officeModel.replace(/^export\s+(?=(?:function|const|let|class)\b)/gm, '');
const appInline = officeApp.replace(/^import\s+\{[^}]+\}\s+from\s+['"]\.\/office-model\.mjs['"];?\s*$/m, '');
if (/^\s*(?:import|export)\s/m.test(modelInline + '\n' + appInline)) throw new Error('Unsupported module import/export in office preview');
const moduleSource = `const { deriveOffice } = (() => {\n${modelInline}\nreturn { deriveOffice };\n})();\n${appInline}`;
const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: moduleSource, encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr);
const frames = createOfficeDemoFrames();
const officePreview = officeHTML
  .replace('<link rel="stylesheet" href="./office.css">', () => `<style>${safeStyle(officeCSS)}</style>`)
  .replace(/\s*<script type="module" src="\.\/office\.js"><\/script>/, '')
  .replace('src="./office-scene.svg"', () => `src="data:image/svg+xml;base64,${Buffer.from(scene).toString('base64')}"`)
  .replace('id="dashboard-link" href="./"', 'id="dashboard-link" href="./agent-observatory-preview.html"')
  .replace('</body>', () => `<script>window.__AGENT_OBSERVATORY_OFFICE_FRAMES__=${safeJSON(frames)};window.__AGENT_OBSERVATORY_SNAPSHOT__=window.__AGENT_OBSERVATORY_OFFICE_FRAMES__[0].snapshot;</script>\n<script type="module">${safeScript(moduleSource)}</script>\n</body>`);
if (/\b(?:src|href)="\.\/office\.(?:js|css)"|src="\.\/office-scene\.svg"/.test(officePreview)) throw new Error('External office asset survived preview build');
const officeOutput = resolve(root, 'artifacts/agent-observatory-office-preview.html');
await writeFile(officeOutput, officePreview, 'utf8');
process.stdout.write(`${output}\n${officeOutput}\nStandalone previews; office has ${frames.length} labelled synthetic replay steps; no external runtime assets.\n`);
