#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { scanRepository, buildBountyBrief, toMarkdown } from './core.js';

const VERSION = '1.0.0';
const HELP = `
Gibwork DevOps Toolkit ${VERSION}
Terminal-first repository triage and bounty preparation.

Usage:
  gibtriage triage [directory] [--out directory]
  gibtriage brief [directory] [--out directory] [--title "Bounty title"]
  gibtriage bounties [--page N] [--limit N]
  gibtriage doctor
  gibtriage --help

Commands:
  triage     Scan source files and write Markdown + JSON reports.
  brief      Scan the repository and create a draft bounty brief.
  bounties   Discover available tasks through the official Gibwork CLI.
  doctor     Check Node.js and Gibwork CLI availability.

Safety: triage and brief are local-only. They never publish a bounty or submit a payment.
`;

function parseArgs(args) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out' || arg === '--title' || arg === '--page' || arg === '--limit') {
      if (!args[i + 1]) throw new Error(`Missing value for ${arg}`);
      flags[arg.slice(2)] = args[++i];
    } else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positionals.push(arg);
  }
  return { positionals, flags };
}

function runGibwork(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('gibwork', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk);
    child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
    child.on('error', error => reject(new Error(`Could not start the Gibwork CLI. Install @gibwork/cli first. Details: ${error.message}`)));
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`Gibwork CLI exited with code ${code}. ${stderr.trim()}`)));
  });
}

async function writeReport(report, outputDir, includeBrief, title) {
  const out = path.resolve(outputDir);
  await fs.mkdir(out, { recursive: true });
  const jsonPath = path.join(out, 'triage-report.json');
  const mdPath = path.join(out, 'triage-report.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(mdPath, toMarkdown(report), 'utf8');
  console.log(`\nScan complete: ${report.summary.totalFindings} finding(s) in ${report.summary.filesScanned} file(s).`);
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown:    ${mdPath}`);
  if (includeBrief) {
    const briefPath = path.join(out, 'bounty-brief.md');
    await fs.writeFile(briefPath, buildBountyBrief(report, { title }), 'utf8');
    console.log(`Bounty draft: ${briefPath}`);
  }
  if (report.warnings.length) console.warn(`Warnings: ${report.warnings.length}. Review the report before relying on completeness.`);
}

async function main() {
  const [command = '--help', ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || command === 'help') { console.log(HELP); return; }
  if (command === '--version' || command === '-v') { console.log(VERSION); return; }
  if (command === 'doctor') {
    console.log(`Node.js: ${process.version} ${Number(process.versions.node.split('.')[0]) >= 22 ? '(supported)' : '(Node 22+ recommended)'}`);
    try {
      const result = await runGibwork(['--version']);
      console.log(`Gibwork CLI: available${result.stdout.trim() ? ` (${result.stdout.trim()})` : ''}`);
    } catch (error) {
      console.log(`Gibwork CLI: not ready — ${error.message}`);
      console.log('Install with: npm install --global @gibwork/cli');
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'bounties') {
    const { flags } = parseArgs(args);
    const page = Number(flags.page ?? 1);
    const limit = Number(flags.limit ?? 10);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('--page must be >= 1 and --limit must be between 1 and 100.');
    }
    const { stdout, stderr } = await runGibwork(['--json', 'task', 'available', '--page', String(page), '--limit', String(limit)]);
    try {
      const parsed = JSON.parse(stdout);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      if (stdout.trim()) console.log(stdout.trim());
      if (stderr.trim()) console.error(stderr.trim());
      throw new Error('Gibwork CLI returned output that was not valid JSON.');
    }
    return;
  }
  if (command === 'triage' || command === 'brief') {
    const { positionals, flags } = parseArgs(args);
    const target = positionals[0] || '.';
    const output = flags.out || './gibwork-output';
    const report = await scanRepository(target);
    await writeReport(report, output, command === 'brief', flags.title);
    return;
  }
  throw new Error(`Unknown command: ${command}\nRun "gibtriage --help" for usage.`);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
