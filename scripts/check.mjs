#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function walk(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (['node_modules', 'artifacts', '.git'].includes(entry.name)) continue;
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
}
const files = await walk(root);
let scripts = 0;
for (const file of files) {
  if (['.mjs', '.js'].includes(extname(file))) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}\n${result.stderr}`);
    scripts++;
  }
  if (extname(file) === '.json') JSON.parse(await readFile(file, 'utf8'));
}
const readJson = async file => JSON.parse(await readFile(resolve(root, file), 'utf8'));
const pkg = await readJson('package.json');
const plugin = await readJson('plugin/.claude-plugin/plugin.json');
const marketplace = await readJson('.claude-plugin/marketplace.json');
const hooks = await readJson('plugin/hooks/hooks.json');
assert.equal(plugin.name, pkg.name);
assert.equal(plugin.version, pkg.version);
assert.equal(marketplace.plugins[0].name, plugin.name);
assert.equal(marketplace.plugins[0].version, plugin.version);
await access(resolve(root, marketplace.plugins[0].source, '.claude-plugin/plugin.json'));
for (const module of hooks.modules) await access(resolve(root, 'plugin/hooks', module));
for (const groups of Object.values(hooks.hooks)) for (const group of groups) for (const hook of group.hooks) {
  assert.equal(hook.type, 'command');
  assert.equal(hook.command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/collect.mjs"');
  assert.ok(hook.timeout > 0 && hook.timeout <= 5);
}
for (const name of ['index.html', 'office.html']) {
  const html = await readFile(resolve(root, 'plugin/web', name), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${name}: duplicate HTML id`);
  for (const match of html.matchAll(/\bfor="([^"]+)"/g)) assert.ok(ids.includes(match[1]), `${name}: missing label target ${match[1]}`);
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) await access(resolve(root, 'plugin/web', match[1]));
}
for (const name of ['app.js', 'office.js']) {
  const app = await readFile(resolve(root, 'plugin/web', name), 'utf8');
  assert.doesNotMatch(app, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|eval)\b/, `${name}: dynamic HTML or code sink needs review`);
}
process.stdout.write(`OK: ${scripts} JavaScript modules; JSON, manifest links, hook paths and static HTML checks.\nThis is a local consistency check, not Claude Code runtime validation.\n`);
