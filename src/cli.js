import { makeGit, GitError } from './git.js';
import { printReport } from './report.js';

const HELP = `
merge-tool - merge multiple git branches in one pass

Usage:
  merge-tool [options] <branch...>

Options:
  --into <branch>    Branch to merge into (default: current branch)
  --remote <name>    Remote to compare against (default: origin)
  --no-fetch         Don't fetch from the remote before comparing
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
`;

function parseArgs(argv) {
  const opts = { into: null, remote: 'origin', fetch: true, dryRun: false, branches: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
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
  return opts;
}

export function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    console.error(HELP);
    process.exit(1);
  }

  if (opts.help || opts.branches.length === 0) {
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

  if (opts.into) {
    if (!git.localBranchExists(opts.into)) {
      console.error(`--into branch "${opts.into}" does not exist locally.`);
      process.exit(1);
    }
    if (opts.dryRun) {
      console.log(`[dry-run] would checkout "${opts.into}"`);
    } else {
      git.checkout(opts.into);
    }
  }

  const target = opts.into || git.currentBranch();
  console.log(`Merging into "${target}"${opts.dryRun ? ' (dry run)' : ''}\n`);

  const results = {
    notFound: [],
    conflicted: [],
    merged: [],
    alreadyMerged: [],
  };

  for (const branch of opts.branches) {
    console.log(`-- ${branch}`);

    const localExists = git.localBranchExists(branch);
    let remoteExists = false;

    if (hasRemote) {
      remoteExists = git.remoteBranchExistsOnServer(remote, branch);
      if (remoteExists && opts.fetch && !opts.dryRun) {
        try {
          git.fetchBranch(remote, branch);
        } catch (err) {
          console.log(`   could not fetch ${remote}/${branch}: ${err.message}`);
          remoteExists = false;
        }
      }
    }

    if (!localExists && !remoteExists) {
      console.log('   not found locally or on remote');
      results.notFound.push(branch);
      continue;
    }

    let source;
    let sourceDescription;

    if (localExists && remoteExists && !opts.dryRun) {
      const localDate = git.commitDate(`refs/heads/${branch}`);
      const remoteDate = git.commitDate(`refs/remotes/${remote}/${branch}`);
      if (remoteDate && (!localDate || remoteDate > localDate)) {
        source = `${remote}/${branch}`;
        sourceDescription = `${remote}/${branch} (remote is newer: ${remoteDate.toISOString()} > ${localDate?.toISOString() ?? 'n/a'})`;
      } else {
        source = branch;
        sourceDescription = `${branch} (local is newer or same: ${localDate?.toISOString() ?? 'n/a'} >= ${remoteDate?.toISOString() ?? 'n/a'})`;
      }
    } else if (localExists) {
      source = branch;
      sourceDescription = opts.dryRun && remoteExists ? `${branch} (dry-run: skipping date comparison)` : branch;
    } else {
      source = `${remote}/${branch}`;
      sourceDescription = `${remote}/${branch} (no local branch)`;
    }

    console.log(`   source: ${sourceDescription}`);

    if (opts.dryRun) {
      console.log('   [dry-run] would attempt merge');
      continue;
    }

    const mergeResult = git.merge(source);

    if (mergeResult.status === 0) {
      if (/already up to date/i.test(mergeResult.stdout)) {
        console.log('   already merged');
        results.alreadyMerged.push(branch);
      } else {
        console.log('   merged');
        results.merged.push(branch);
      }
      continue;
    }

    // Merge failed - assume conflict, clean up, and move on.
    console.log('   conflict - aborting merge and continuing');
    if (git.mergeInProgress()) {
      git.abortMerge();
    }
    if (!git.isClean()) {
      git.resetHard(target);
    }
    results.conflicted.push(branch);
  }

  if (!opts.dryRun) {
    printReport(results, target);
  }

  if (opts.dryRun) {
    console.log('\n[dry-run] no changes were made');
  }
}
