import { readFileSync } from 'node:fs';

export function makeColors(stream) {
  const enabled = Boolean(stream?.isTTY) && !process.env.NO_COLOR;
  const wrap = (code) =>
    enabled ? (s) => `\x1b[${code}m${s}\x1b[0m` : (s) => s;
  return {
    bold: wrap(1),
    dim: wrap(2),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    cyan: wrap(36),
  };
}

function section(colors, title, branches, colorFn) {
  const header = colorFn(colors.bold(`${title} (${branches.length})`));
  if (branches.length === 0) {
    return `${header}\n  ${colors.dim('none')}`;
  }
  return `${header}\n${branches.map((b) => `  - ${b}`).join('\n')}`;
}

export function printReport(results, target, stream = process.stdout) {
  const colors = makeColors(stream);
  const lines = [
    '',
    `${colors.bold('=== Merge report ===')} (into "${target}")`,
    '',
    section(colors, 'Merged', results.merged, colors.green),
    '',
    section(colors, 'Already merged', results.alreadyMerged, colors.dim),
    '',
    section(colors, 'Conflicted (skipped)', results.conflicted, colors.yellow),
    '',
    section(colors, 'Not found', results.notFound, colors.red),
    '',
  ];
  stream.write(`${lines.join('\n')}\n`);
}

let cachedVersion;
function toolVersion() {
  if (cachedVersion === undefined) {
    try {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      cachedVersion = pkg.version ?? null;
    } catch {
      cachedVersion = null;
    }
  }
  return cachedVersion;
}

/**
 * Machine-readable report. `branches` keeps the per-branch detail (which ref was
 * actually merged, and why) that the text report has no room for; `summary` is
 * the same grouping the text report prints.
 */
export function buildJsonReport({ records, target, remote, dryRun, startedAt, finishedAt }) {
  const byStatus = (status) => records.filter((r) => r.status === status).map((r) => r.branch);
  return {
    tool: 'merge-tool',
    version: toolVersion(),
    schemaVersion: 1,
    target,
    remote,
    dryRun,
    startedAt,
    finishedAt,
    summary: {
      requested: records.length,
      merged: byStatus('merged'),
      alreadyMerged: byStatus('alreadyMerged'),
      conflicted: byStatus('conflicted'),
      notFound: byStatus('notFound'),
      wouldMerge: byStatus('wouldMerge'),
    },
    branches: records,
  };
}

export function printJsonReport(report, stream = process.stdout) {
  stream.write(`${JSON.stringify(report, null, 2)}\n`);
}
