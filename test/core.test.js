import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanRepository, buildBountyBrief, toMarkdown } from '../src/core.js';

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gibtriage-'));
  await fs.mkdir(path.join(dir, 'node_modules', 'ignored'), { recursive: true });
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src', 'main.ts'), 'const a = 1; // TODO: finish validation\n// FIXME: handle missing input\n// OPTIMIZE this loop\n');
  await fs.writeFile(path.join(dir, 'node_modules', 'ignored', 'vendor.js'), '// FIXME: should not be scanned\n');
  return dir;
}

test('scanner finds markers and skips dependency directories', async () => {
  const dir = await fixture();
  try {
    const report = await scanRepository(dir);
    assert.equal(report.summary.totalFindings, 3);
    assert.equal(report.summary.byKind.FIXME, 1);
    assert.ok(report.findings.every(f => f.file === 'src/main.ts'));
    assert.equal(report.findings[0].kind, 'FIXME');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('reports and bounty brief contain practical verification steps', async () => {
  const dir = await fixture();
  try {
    const report = await scanRepository(dir);
    assert.match(toMarkdown(report), /Repository Triage Report/);
    const brief = buildBountyBrief(report);
    assert.match(brief, /Acceptance criteria/);
    assert.match(brief, /verification procedure/);
    assert.match(brief, /No bounty is created automatically/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('rejects a file path instead of a directory', async () => {
  const dir = await fixture();
  try {
    await assert.rejects(scanRepository(path.join(dir, 'src', 'main.ts')), /Expected a directory/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
