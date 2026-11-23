#!/usr/bin/env node
// Conservative pre-publication scan; no network calls or printing matched values.
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excluded = new Set(['.git', 'node_modules', 'artifacts', '.runtime', 'coverage']);
const rules = [
  ['GitHub/GitLab token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,})\b/g],
  ['API/cloud credential', /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{18,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/g],
  ['Personal email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['User home directory', /(?:\b[A-Za-z]:[\\/]Users[\\/]|\/(?:Users|home)\/)[^\s"'<>\x60]{3,}/g],
  ['Database URI with embedded user info', /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql|redis):\/\/[^\s"'<>\x60@]+@/gi],
];
const findings = [];
let count = 0;
async function visit(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    if (excluded.has(item.name)) continue;
    const file = resolve(folder, item.name);
    if (item.isDirectory()) { await visit(file); continue; }
    if (!item.isFile()) continue;
    count++;
    const content = await readFile(file, 'utf8');
    for (const [name, regex] of rules) {
      regex.lastIndex = 0;
      if (regex.test(content)) findings.push({ path: relative(root, file), rule: name });
    }
  }
}
await visit(root);
for (const entry of findings) console.error('Review ' + entry.path + ': ' + entry.rule);
if (findings.length) {
  console.error('Privacy check failed: ' + findings.length + ' possible sensitive matches; no values printed.');
  process.exitCode = 1;
} else {
  console.log('Privacy check passed: ' + count + ' files; no matches for common high-risk patterns. Manual review remains necessary.');
}
