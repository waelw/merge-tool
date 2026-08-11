import { makeGit } from './git.js';
import { printReport, buildJsonReport, printJsonReport } from './report.js';
import { selectBranches, InteractiveError } from './interactive.js';

const HELP = `
merge-tool - merge multiple git branches in one pass

Usage:
  merge-tool [options] <branch...>
  merge-tool -i [options]

Options:
  -i, --interactive  Pick branches from a list instead of naming them
  --into <branch>    Branch to merge into (default: current branch)
  --remote <name>    Remote to compare against (default: origin)
  --no-fetch         Don't touch the network; use locally tracked remote refs
  --json             Print the report as JSON on stdout (progress goes to stderr)
  --dry-run          Show what would happen without changing anything
  -h, --help         Show this help

Behavior:
  For each branch given:
    - If it doesn't exist locally or on the remote, it's reported as "not found".
    - If it exists in both places, the local and remote tips are compared by
      commit date and the more recent one is used as the merge source.
    - If merging produces a conflict, the merge is aborted and the branch is
      set aside so the rest can continue.
    - If it's already merged in, it's reported separately from fresh merges.

  A final report lists: not found, conflicted, merged, and already-merged
  branches.

Interactive mode:
  -i lists every local and remote branch except the target. Branches already
  merged into the target are dimmed and sorted last. Any branch names given on
  the command line start out selected.

  ↑/↓ (or j/k) move · space selects · a selects all · / filters
  enter confirms · q or Esc cancels

JSON output:
  --json writes one object to stdout: target, remote, a summary grouped the
  same way as the text report, and a per-branch list recording which ref was
  merged, why it was chosen, and any conflicting files. Redirect it to export:

    merge-tool --json feature-a feature-b > report.json
`;

function parseArgs(argv) {
  const opts = {
    into: null,
    remote: 'origin',
    fetch: true,
    dryRun: false,
    json: false,
    interactive: false,
    branches: [],
  };
  let onlyPositional = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (onlyPositional) {
      opts.branches.push(arg);
      continue;
    }
    switch (arg) {
      case '--':
        onlyPositional = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-i':
      case '--interactive':
        opts.interactive = true;
        break;
      case '--into':
        opts.into = argv[++i];
        break;
      case '--remote':
        opts.remote = argv[++i];
        break;
      case '--no-fetch':
        opts.fetch = false;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        opts.branches.push(arg);
    }
  }
  if (opts.into === undefined || opts.remote === undefined) {
    throw new Error('Missing value for an option');
  }
  return opts;
}

export async function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    console.error(HELP);
    process.exit(1);
  }

  // With --json, stdout is reserved for the report so it stays pipeable.
  const out = opts.json ? process.stderr : process.stdout;
  const say = (line = '') => out.write(`${line}\n`);

  if (opts.help || (opts.branches.length === 0 && !opts.interactive)) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  const cwd = process.cwd();
  const git = makeGit(cwd);

  if (!git.isRepo()) {
    console.error(`Not a git repository: ${cwd}`);
    process.exit(1);
  }

  if (!git.isClean()) {
    console.error('Working tree has uncommitted changes. Commit or stash them before running merge-tool.');
    process.exit(1);
  }

  const remote = opts.remote;
  const hasRemote = git.hasRemote(remote);

  // One lookup of the remote's branch list, shared by the picker and the merge
  // loop, instead of an ls-remote per branch.
  let remoteHeadsCache;
  function remoteHeads() {
    if (remoteHeadsCache) return remoteHeadsCache;
    if (!hasRemote) {
      remoteHeadsCache = new Set();
      return remoteHeadsCache;
    }
    if (opts.fetch) {
      const heads = git.listRemoteHeads(remote);
      if (heads) {
        remoteHeadsCache = new Set(heads);
        return remoteHeadsCache;
      }
      say(`warning: could not reach "${remote}"; falling back to locally tracked refs`);
    }
    remoteHeadsCache = new Set(git.listTrackedRemoteBranches(remote));
    return remoteHeadsCache;
  }

  if (opts.into) {
    if (!git.localBranchExists(opts.into)) {
      console.error(`--into branch "${opts.into}" does not exist locally.`);
      process.exit(1);
    }
    if (opts.dryRun) {
      say(`[dry-run] would checkout "${opts.into}"`);
    } else {
      git.checkout(opts.into);
    }
  }

  const target = opts.into || git.currentBranch();

  if (opts.interactive) {
    const localBranches = new Set(git.listLocalBranches());
    const remoteBranches = remoteHeads();
    const candidates = [...new Set([...localBranches, ...remoteBranches])]
      .filter((name) => name !== target)
      .map((name) => ({
        name,
        local: localBranches.has(name),
        remote: remoteBranches.has(name),
        // Advisory, and only answerable from local data.
        merged: localBranches.has(name) ? git.isAncestor(`refs/heads/${name}`, target) : false,
      }))
      .sort((a, b) => Number(a.merged) - Number(b.merged) || a.name.localeCompare(b.name));

    let chosen;
    try {
      chosen = await selectBranches({
        candidates,
        target,
        remote,
        preselected: opts.branches,
        output: out,
      });
    } catch (err) {
      if (err instanceof InteractiveError) {
        console.error(err.message);
        process.exit(1);
      }
      throw err;
    }

    if (chosen === null) {
      process.exit(130);
    }
    if (chosen.length === 0) {
      if (opts.json) {
        printJsonReport(
          buildJsonReport({
            records: [],
            target,
            remote,
            dryRun: opts.dryRun,
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          }),
        );
      }
      process.exit(0);
    }
    opts.branches = chosen;
    say();
  }

  say(`Merging into "${target}"${opts.dryRun ? ' (dry run)' : ''}\n`);

  const startedAt = new Date().toISOString();
  const records = [];

  for (const branch of opts.branches) {
    say(`-- ${branch}`);

    const record = {
      branch,
      status: null,
      existsLocally: git.localBranchExists(branch),
      existsOnRemote: false,
      source: null,
      sourceLocation: null,
      reason: null,
    };
    records.push(record);

    let remoteExists = false;
    if (hasRemote) {
      remoteExists = remoteHeads().has(branch);
      if (remoteExists && opts.fetch && !opts.dryRun) {
        try {
          git.fetchBranch(remote, branch);
        } catch (err) {
          say(`   could not fetch ${remote}/${branch}: ${err.message}`);
          remoteExists = false;
        }
      }
    }
    record.existsOnRemote = remoteExists;

    if (!record.existsLocally && !remoteExists) {
      say('   not found locally or on remote');
      record.status = 'notFound';
      record.reason = 'no local branch and no matching branch on the remote';
      continue;
    }

    let sourceDescription;

    if (record.existsLocally && remoteExists && !opts.dryRun) {
      const localDate = git.commitDate(`refs/heads/${branch}`);
      const remoteDate = git.commitDate(`refs/remotes/${remote}/${branch}`);
      if (remoteDate && (!localDate || remoteDate > localDate)) {
        record.source = `${remote}/${branch}`;
        record.sourceLocation = 'remote';
        sourceDescription = `${remote}/${branch} (remote is newer: ${remoteDate.toISOString()} > ${localDate?.toISOString() ?? 'n/a'})`;
      } else {
        record.source = branch;
        record.sourceLocation = 'local';
        sourceDescription = `${branch} (local is newer or same: ${localDate?.toISOString() ?? 'n/a'} >= ${remoteDate?.toISOString() ?? 'n/a'})`;
      }
    } else if (record.existsLocally) {
      record.source = branch;
      record.sourceLocation = 'local';
      sourceDescription =
        opts.dryRun && remoteExists ? `${branch} (dry-run: skipping date comparison)` : branch;
    } else {
      record.source = `${remote}/${branch}`;
      record.sourceLocation = 'remote';
      sourceDescription = `${remote}/${branch} (no local branch)`;
    }

    record.reason = sourceDescription;
    say(`   source: ${sourceDescription}`);

    if (opts.dryRun) {
      say('   [dry-run] would attempt merge');
      record.status = 'wouldMerge';
      continue;
    }

    const mergeResult = git.merge(record.source);

    if (mergeResult.status === 0) {
      if (/already up to date/i.test(mergeResult.stdout)) {
        say('   already merged');
        record.status = 'alreadyMerged';
      } else {
        say('   merged');
        record.status = 'merged';
      }
      continue;
    }

    // Merge failed. Unmerged paths mean a real conflict; anything else is git
    // refusing for some other reason, which is worth recording verbatim.
    const conflictingFiles = git.unmergedFiles();
    record.status = 'conflicted';
    record.conflictingFiles = conflictingFiles;
    if (conflictingFiles.length > 0) {
      const shown = conflictingFiles.slice(0, 5).join(', ');
      const more = conflictingFiles.length > 5 ? `, +${conflictingFiles.length - 5} more` : '';
      say(`   conflict in ${conflictingFiles.length} file(s): ${shown}${more}`);
    } else {
      record.error = (mergeResult.stderr || mergeResult.stdout).split('\n')[0] || 'merge failed';
      say(`   merge failed: ${record.error}`);
    }
    say('   aborting merge and continuing');

    if (git.mergeInProgress()) {
      git.abortMerge();
    }
    if (!git.isClean()) {
      git.resetHard(target);
    }
  }

  const byStatus = (status) => records.filter((r) => r.status === status).map((r) => r.branch);

  if (opts.json) {
    printJsonReport(
      buildJsonReport({
        records,
        target,
        remote,
        dryRun: opts.dryRun,
        startedAt,
        finishedAt: new Date().toISOString(),
      }),
    );
  }

  if (!opts.dryRun) {
    printReport(
      {
        merged: byStatus('merged'),
        alreadyMerged: byStatus('alreadyMerged'),
        conflicted: byStatus('conflicted'),
        notFound: byStatus('notFound'),
      },
      target,
      out,
    );
  } else {
    say('\n[dry-run] no changes were made');
  }
}
