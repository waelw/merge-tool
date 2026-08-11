import { execFileSync } from 'node:child_process';

export class GitError extends Error {
  constructor(message, { stderr, status } = {}) {
    super(message);
    this.name = 'GitError';
    this.stderr = stderr;
    this.status = status;
  }
}

export function makeGit(cwd) {
  function git(args, { allowFailure = false } = {}) {
    try {
      const stdout = execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stdout: stdout.trim(), stderr: '' };
    } catch (err) {
      const stdout = (err.stdout ?? '').toString().trim();
      const stderr = (err.stderr ?? '').toString().trim();
      if (allowFailure) {
        return { status: err.status ?? 1, stdout, stderr };
      }
      throw new GitError(`git ${args.join(' ')} failed: ${stderr || err.message}`, {
        stderr,
        status: err.status,
      });
    }
  }

  return {
    isRepo() {
      const r = git(['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
      return r.status === 0 && r.stdout === 'true';
    },
    currentBranch() {
      return git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
    },
    isClean() {
      return git(['status', '--porcelain']).stdout === '';
    },
    hasRemote(remote) {
      const r = git(['remote'], { allowFailure: true });
      return r.stdout.split('\n').includes(remote);
    },
    localBranchExists(branch) {
      const r = git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
        allowFailure: true,
      });
      return r.status === 0;
    },
    listLocalBranches() {
      const r = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], {
        allowFailure: true,
      });
      return r.stdout ? r.stdout.split('\n').filter(Boolean) : [];
    },
    /** Branch names on the server. One network call; null if the remote is unreachable. */
    listRemoteHeads(remote) {
      const r = git(['ls-remote', '--heads', remote], { allowFailure: true });
      if (r.status !== 0) return null;
      return r.stdout
        .split('\n')
        .map((line) => line.split('\t')[1])
        .filter(Boolean)
        .map((ref) => ref.replace(/^refs\/heads\//, ''));
    },
    /** Branch names under refs/remotes/<remote> - no network, possibly stale. */
    listTrackedRemoteBranches(remote) {
      const r = git(['for-each-ref', '--format=%(refname:short)', `refs/remotes/${remote}`], {
        allowFailure: true,
      });
      if (!r.stdout) return [];
      const prefix = `${remote}/`;
      return r.stdout
        .split('\n')
        .filter(Boolean)
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length))
        .filter((name) => name !== 'HEAD');
    },
    fetchBranch(remote, branch) {
      git(['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
    },
    commitDate(ref) {
      const r = git(['log', '-1', '--format=%cI', ref], { allowFailure: true });
      if (r.status !== 0 || !r.stdout) return null;
      return new Date(r.stdout);
    },
    checkout(branch) {
      git(['checkout', branch]);
    },
    isAncestor(ref, target) {
      const r = git(['merge-base', '--is-ancestor', ref, target], { allowFailure: true });
      return r.status === 0;
    },
    merge(ref) {
      return git(['merge', '--no-edit', ref], { allowFailure: true });
    },
    unmergedFiles() {
      const r = git(['diff', '--name-only', '--diff-filter=U'], { allowFailure: true });
      return r.stdout ? r.stdout.split('\n').filter(Boolean) : [];
    },
    mergeInProgress() {
      const r = git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { allowFailure: true });
      return r.status === 0;
    },
    abortMerge() {
      git(['merge', '--abort'], { allowFailure: true });
    },
    resetHard(ref) {
      git(['reset', '--hard', ref], { allowFailure: true });
    },
  };
}
