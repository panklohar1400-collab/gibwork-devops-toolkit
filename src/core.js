import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_IGNORES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'coverage',
  '.next', '.nuxt', '.venv', 'venv', '__pycache__', 'target', 'out'
]);
const TEXT_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go', '.rs', '.java',
  '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.rb', '.sh',
  '.bash', '.zsh', '.yaml', '.yml', '.toml', '.json', '.md', '.sql', '.html',
  '.css', '.scss', '.xml', '.tf', '.dockerfile', '.env.example'
]);
const MARKERS = [
  { pattern: /\bTODO\b/i, kind: 'TODO', priority: 2 },
  { pattern: /\bFIXME\b/i, kind: 'FIXME', priority: 3 },
  { pattern: /\bHACK\b/i, kind: 'HACK', priority: 2 },
  { pattern: /\bOPTIMIZE\b/i, kind: 'OPTIMIZE', priority: 1 },
  { pattern: /\bXXX\b/i, kind: 'XXX', priority: 2 }
];

function shouldSkip(name, fullPath, root) {
  if (DEFAULT_IGNORES.has(name)) return true;
  if (name.startsWith('.env') && name !== '.env.example') return true;
  const relative = path.relative(root, fullPath).split(path.sep);
  return relative.some(part => DEFAULT_IGNORES.has(part));
}

function likelyTextFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(path.extname(name)) || name === 'dockerfile' || name === 'makefile' || name === '.env.example';
}

export async function scanRepository(target, options = {}) {
  const root = path.resolve(target);
  const maxFileBytes = options.maxFileBytes ?? 1_000_000;
  const maxFiles = options.maxFiles ?? 20_000;
  const findings = [];
  const errors = [];
  let filesScanned = 0;
  let filesSkipped = 0;

  let rootStat;
  try { rootStat = await fs.stat(root); }
  catch { throw new Error(`Path does not exist or cannot be accessed: ${root}`); }
  if (!rootStat.isDirectory()) throw new Error(`Expected a directory: ${root}`);

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (filesScanned + filesSkipped >= maxFiles) {
        errors.push(`Scan limit reached (${maxFiles} entries); results may be incomplete.`);
        return;
      }
      const fullPath = path.join(directory, entry.name);
      if (shouldSkip(entry.name, fullPath, root)) { filesSkipped++; continue; }
      if (entry.isDirectory()) { await walk(fullPath); continue; }
      if (!entry.isFile() || !likelyTextFile(fullPath)) { filesSkipped++; continue; }
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > maxFileBytes) { filesSkipped++; continue; }
        const content = await fs.readFile(fullPath, 'utf8');
        // Ignore files that look binary rather than attempting to interpret them as source.
        if (content.includes('\u0000')) { filesSkipped++; continue; }
        filesScanned++;
        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
          const marker = MARKERS.find(item => item.pattern.test(line));
          if (!marker) return;
          findings.push({
            id: `${path.relative(root, fullPath).split(path.sep).join('/')}:${index + 1}:${marker.kind}`,
            kind: marker.kind,
            priority: marker.priority,
            file: path.relative(root, fullPath).split(path.sep).join('/'),
            line: index + 1,
            excerpt: line.trim().slice(0, 220)
          });
        });
      } catch (error) {
        errors.push(`Could not read ${path.relative(root, fullPath)}: ${error.message}`);
      }
    }
  }
  await walk(root);
  findings.sort((a, b) => b.priority - a.priority || a.file.localeCompare(b.file) || a.line - b.line);
  return {
    root,
    generatedAt: new Date().toISOString(),
    summary: {
      filesScanned,
      filesSkipped,
      totalFindings: findings.length,
      byKind: Object.fromEntries(MARKERS.map(m => [m.kind, findings.filter(f => f.kind === m.kind).length]))
    },
    findings,
    warnings: errors
  };
}

export function buildBountyBrief(report, options = {}) {
  const projectName = options.projectName || path.basename(report.root);
  const title = options.title || `Resolve technical-debt findings in ${projectName}`;
  const highPriority = report.findings.filter(f => f.priority >= 3);
  const sample = report.findings.slice(0, 30);
  const acceptance = [
    'Each selected finding is resolved or explicitly documented with a reason for deferral.',
    'Changes include focused tests or a repeatable verification procedure where practical.',
    'No unrelated behavior changes or secrets are introduced.',
    'The project’s existing checks pass, or any pre-existing failures are clearly documented.'
  ];
  return `# ${title}\n\n` +
    `## Problem\n\nA local repository scan identified **${report.summary.totalFindings}** potential maintenance markers across **${report.summary.filesScanned}** scanned text files. These markers can represent unfinished work, known defects, shortcuts, or optimization opportunities. Each finding must be reviewed by a developer before implementation; a marker alone does not prove a defect exists.\n\n` +
    `## Proposed scope\n\n- Review and classify the findings listed below.\n- Prioritize confirmed defects and high-impact maintenance risks.\n- Implement a focused set of fixes with minimal unrelated changes.\n- Add or update tests and document any intentionally deferred item.\n\n` +
    `## Scan summary\n\n| Metric | Count |\n|---|---:|\n| Files scanned | ${report.summary.filesScanned} |\n| Total findings | ${report.summary.totalFindings} |\n| FIXME | ${report.summary.byKind.FIXME} |\n| TODO | ${report.summary.byKind.TODO} |\n| HACK | ${report.summary.byKind.HACK} |\n| OPTIMIZE | ${report.summary.byKind.OPTIMIZE} |\n| XXX | ${report.summary.byKind.XXX} |\n| High-priority markers (FIXME) | ${highPriority.length} |\n\n` +
    `## Acceptance criteria\n\n${acceptance.map(item => `- [ ] ${item}`).join('\n')}\n\n` +
    `## Verification plan\n\n1. Reproduce each confirmed issue before changing code.\n2. Run the relevant unit and integration tests.\n3. Run the project’s lint, type-check, and build commands when available.\n4. Review the final diff for scope, regressions, and accidental secrets.\n\n` +
    `## Findings to review\n\n${sample.length ? sample.map(f => `- **${f.kind}** — ${f.file}:${f.line} — ${f.excerpt.replace(/\|/g, '\\|')}`).join('\n') : '_No supported maintenance markers were found by this scan._'}\n\n` +
    `${report.findings.length > sample.length ? `_${report.findings.length - sample.length} additional findings were omitted from this brief. See the JSON report for the complete list._\n\n` : ''}` +
    `## Notes\n\nThis document is a draft generated from local source markers. Confirm the scope, reward, dependencies, and expected output before publishing it as a Gibwork bounty. No bounty is created automatically.\n`;
}

export function toMarkdown(report) {
  const rows = report.findings.map(f => `| ${f.kind} | ${f.priority} | \`${f.file}:${f.line}\` | ${f.excerpt.replace(/\|/g, '\\|')} |`);
  return `# Repository Triage Report\n\n- **Repository:** \`${report.root}\`\n- **Generated:** ${report.generatedAt}\n- **Files scanned:** ${report.summary.filesScanned}\n- **Files skipped:** ${report.summary.filesSkipped}\n- **Findings:** ${report.summary.totalFindings}\n\n## Counts by marker\n\n${Object.entries(report.summary.byKind).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Findings\n\n| Marker | Priority | Location | Excerpt |\n|---|---:|---|---|\n${rows.length ? rows.join('\n') : '| — | — | — | No findings |'}\n\n## Warnings\n\n${report.warnings.length ? report.warnings.map(w => `- ${w}`).join('\n') : 'None.'}\n`;
}
