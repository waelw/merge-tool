# merge-tool

Merge multiple git branches into the current branch in one pass. Conflicting
branches are set aside automatically so the rest keep merging, and you get a
report at the end.

## Requirements

- **Node.js 18 or newer** — check with `node --version`
- **Git** — must be on your `PATH`; the tool shells out to the plain `git` CLI

There are no npm dependencies to install.

## Install

Pick the section for your OS. All three end with a `merge-tool` command on your
`PATH`.

### macOS

```bash
# 1. Prerequisites (skip any you already have)
brew install node git

# 2. Get the code
git clone https://github.com/waelw/merge-tool.git
cd merge-tool

# 3. Put `merge-tool` on your PATH
npm link
```

If `npm link` fails with a permissions error, either fix your npm prefix
(`npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to your
`PATH`) or run it with `sudo npm link`.

### Linux

```bash
# 1. Prerequisites (Debian/Ubuntu; use dnf/pacman on other distros)
sudo apt update && sudo apt install -y nodejs npm git

# 2. Get the code
git clone https://github.com/waelw/merge-tool.git
cd merge-tool

# 3. Put `merge-tool` on your PATH
npm link
```

If your distro ships a Node older than 18, install a current one from
[NodeSource](https://github.com/nodesource/distributions) or via
[nvm](https://github.com/nvm-sh/nvm) instead of the distro package.

As on macOS, a permissions error from `npm link` means npm's global prefix
isn't writable — set a user-owned prefix or use `sudo`.

### Windows

Use **PowerShell** (or Git Bash / WSL, where the Linux instructions apply
verbatim).

```powershell
# 1. Prerequisites (skip any you already have)
winget install OpenJS.NodeJS.LTS
winget install Git.Git

# Close and reopen PowerShell so the new PATH entries take effect.

# 2. Get the code
git clone https://github.com/waelw/merge-tool.git
cd merge-tool

# 3. Put `merge-tool` on your PATH
npm link
```

`npm link` creates a `merge-tool.cmd` shim in npm's global folder, so the
command works from PowerShell and `cmd.exe` alike. If PowerShell blocks it with
*"running scripts is disabled on this system"*, allow local scripts once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Verify the install

From any directory:

```bash
merge-tool --help
```

If the command isn't found, npm's global bin directory isn't on your `PATH`.
Print it with `npm bin -g` (older npm) or `npm prefix -g` and add that
directory (`<prefix>/bin` on macOS/Linux, `<prefix>` on Windows) to your
`PATH`.

### Run without installing

If you'd rather not put anything on your `PATH`, call the entrypoint directly
from a clone:

```bash
node /path/to/merge-tool/bin/merge-tool.js feature-a feature-b
```

### Uninstall

```bash
npm unlink -g merge-tool
```

## Usage

Run it from inside the repo you want to merge into:

```bash
merge-tool feature-a feature-b feature-c
```

Options:

```
--into <branch>    Branch to merge into (default: current branch)
--remote <name>    Remote to compare against (default: origin)
--no-fetch         Don't fetch from the remote before comparing
--dry-run          Show what would happen without changing anything
-h, --help         Show help
```

## Behavior

For each branch given:

1. **Existence check** — looks for the branch locally and on the remote
   (`git ls-remote`). If it's in neither place, it's reported as *not found*.
2. **Freshest version wins** — if the branch exists both locally and on the
   remote, their tip commit dates are compared and the newer one is used as
   the merge source (so a stale local branch doesn't shadow a newer pushed
   version, or vice versa).
3. **Merge** — attempts `git merge --no-edit <source>`.
   - Conflict → the merge is aborted (`git merge --abort`, with a
     `git reset --hard` fallback if needed) and the branch is set aside;
     the tool moves on to the next branch.
   - No-op ("Already up to date") → recorded as *already merged*.
   - Clean merge → recorded as *merged*.

The tool refuses to start if the working tree isn't clean, so a failed run
never leaves uncommitted changes lying around.

## Report

At the end you get four lists:

- **Merged** — branches merged successfully this run
- **Already merged** — branches whose changes were already in the target
- **Conflicted (skipped)** — branches that hit a conflict and were left out
- **Not found** — branches that don't exist locally or on the remote
