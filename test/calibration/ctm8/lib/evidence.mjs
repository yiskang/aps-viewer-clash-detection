// CTM8-P0-v4 §12/§13: append-only evidence writing, canonical hashing,
// environment capture and evidence-directory layout. Non-production support only.

import {
  appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { PROTOCOL } from './enumeration.mjs';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

// appendFileSync per line: a crash mid-run keeps every earlier sample.
export function createJsonlSink(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  return { append(record) { appendFileSync(filePath, `${JSON.stringify(record)}\n`); } };
}

export function readJsonl(filePath) {
  return readFileSync(filePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function collectEnvironment({ repoRoot = process.cwd() } = {}) {
  const cpus = os.cpus();
  const lock = path.join(repoRoot, 'package-lock.json');
  const status = git(['status', '--porcelain'], repoRoot);
  return {
    protocol: PROTOCOL,
    machineModel: `${os.type()} ${os.arch()}`,
    cpu: cpus.length ? cpus[0].model : null,
    cpuCores: cpus.length,
    ramBytes: os.totalmem(),
    os: `${os.type()} ${os.release()}`,
    nodeVersion: process.version,
    nodeFlags: process.execArgv,
    powerSource: null, // battery/AC not obtainable from Node; operator records it
    repoCommit: git(['rev-parse', 'HEAD'], repoRoot),
    repoTreeState: status === null ? null : (status === '' ? 'clean' : 'dirty'),
    lockfileSha256: existsSync(lock) ? sha256Hex(readFileSync(lock)) : null,
    browserName: null,
    browserVersion: null,
    viewerVersion: null,
    modelUrns: null,
    devServerState: null,
    nodeEnv: process.env.NODE_ENV ?? null,
    otherHeavyProcesses: null,
    timestamp: new Date().toISOString(),
    timerSource: 'performance.now()',
  };
}

export function createEvidenceLayout(baseDir, date) {
  const root = path.join(baseDir, 'docs', 'research', 'evidence', `${date}-ctm-8-rebuild-cost-calibration`);
  for (const d of ['raw', 'summary', 'fixtures', 'headed']) mkdirSync(path.join(root, d), { recursive: true });
  writeFileSync(path.join(root, 'protocol-version.txt'), `${PROTOCOL}\n`);
  return root;
}

function listFiles(dir, rel = '') {
  const out = [];
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(dir, r)).isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out;
}

// Writes MANIFEST.md then checksums.sha256 (which covers everything but itself).
export function writeManifestAndChecksums(dir) {
  const files = listFiles(dir).filter((f) => f !== 'checksums.sha256' && f !== 'MANIFEST.md');
  const lines = files.map((f) => `- \`${f}\``).join('\n');
  writeFileSync(path.join(dir, 'MANIFEST.md'),
    `# Evidence manifest (${PROTOCOL})\n\nFiles:\n\n${lines}\n\nIntegrity: see \`checksums.sha256\`.\n`);
  const all = [...files, 'MANIFEST.md'].sort();
  const sums = all.map((f) => `${sha256Hex(readFileSync(path.join(dir, f)))}  ${f}`).join('\n');
  writeFileSync(path.join(dir, 'checksums.sha256'), `${sums}\n`);
  return all;
}
