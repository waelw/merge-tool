const colors = process.stdout.isTTY && !process.env.NO_COLOR
  ? {
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
      green: (s) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`,
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
    }
  : { bold: (s) => s, green: (s) => s, yellow: (s) => s, red: (s) => s, dim: (s) => s };

function section(title, branches, colorFn) {
  const header = colorFn(colors.bold(`${title} (${branches.length})`));
  if (branches.length === 0) {
    return `${header}\n  ${colors.dim('none')}`;
  }
  return `${header}\n${branches.map((b) => `  - ${b}`).join('\n')}`;
}

export function printReport(results, target) {
  console.log(`\n${colors.bold('=== Merge report ===')} (into "${target}")\n`);
  console.log(section('Merged', results.merged, colors.green));
  console.log();
  console.log(section('Already merged', results.alreadyMerged, colors.dim));
  console.log();
  console.log(section('Conflicted (skipped)', results.conflicted, colors.yellow));
  console.log();
  console.log(section('Not found', results.notFound, colors.red));
  console.log();
}
