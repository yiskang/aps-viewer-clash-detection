// Loads the machine-readable contract appendices from the two spec parts. Pure, deterministic, read-only.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_DIR = join(HERE, '..');
export const SPEC1 = 'spec-part1-questions-instrumentation-capture.md';
export const SPEC2 = 'spec-part2-controls-envelope-verdict-runbook.md';
const PART2_NAMES = ['envelope', 'verdictTable', 'runbook', 'authBinding', 'manifestSchema', 'stopConditions', 'controlMatrix', 'closeoutSchema'];

function jsonBlocks(text, file) {
  const out = [];
  const re = /^```json\n([\s\S]*?)^```$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    try { out.push(JSON.parse(m[1])); } catch (e) { throw new Error(`${file}: invalid JSON block #${out.length}: ${e.message}`); }
  }
  return out;
}

export function loadContract(dir = PACKAGE_DIR) {
  const b1 = readFileSync(join(dir, SPEC1));
  const b2 = readFileSync(join(dir, SPEC2));
  const p1 = jsonBlocks(b1.toString('utf8'), SPEC1);
  const p2 = jsonBlocks(b2.toString('utf8'), SPEC2);
  if (p1.length !== 1) throw new Error(`${SPEC1}: expected 1 JSON block, found ${p1.length}`);
  if (p2.length !== PART2_NAMES.length) throw new Error(`${SPEC2}: expected ${PART2_NAMES.length} JSON blocks, found ${p2.length}`);
  const contract = { part1: p1[0] };
  PART2_NAMES.forEach((n, i) => { contract[n] = p2[i]; });
  contract.specDigests = {
    part1: createHash('sha256').update(b1).digest('hex'),
    part2: createHash('sha256').update(b2).digest('hex'),
  };
  return contract;
}
