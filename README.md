# merge-tool

Merge multiple git branches into the current branch in one pass. Conflicting
branches are set aside automatically so the rest keep merging, and you get a
report at the end.

## Install

One command — identical on macOS, Linux, and Windows:

```bash
npm install -g merge-tool
```

Needs **Node.js 18+** and **Git** on your `PATH`; there are no other
dependencies. That's it — `merge-tool` is now on your `PATH`; verify with:

```bash
merge-tool --help
```

To upgrade later, run the same install command again. To remove it:

```bash
npm uninstall -g merge-tool
```

### Run it without installing

```bash
npx github:waelw/merge-tool feature-a feature-b
```

### If you don't have Node or Git yet

<details>
<summary><b>macOS</b></summary>

```bash
brew install node git
```

</details>

<details>
<summary><b>Linux</b></summary>

```bash
# Debian/Ubuntu — use dnf/pacman on other distros
sudo apt update && sudo apt install -y nodejs npm git
```

If your distro ships a Node older than 18, install a current one from
[NodeSource](https://github.com/nodesource/distributions) or via
[nvm](https://github.com/nvm-sh/nvm) instead of the distro package.

</details>

<details>
<summary><b>Windows</b></summary>

In PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close and reopen PowerShell so the new `PATH` entries take effect, then run the
install command above. npm creates a `merge-tool.cmd` shim, so it works from
PowerShell and `cmd.exe` alike. If PowerShell blocks it with *"running scripts
is disabled on this system"*, allow local scripts once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Git Bash and WSL work too — follow the Linux notes there.

</details>

<details>
<summary><b>Troubleshooting</b></summary>

**`merge-tool: command not found`** — npm's global bin directory isn't on your
`PATH`. Print it with `npm prefix -g` and add that directory
(`<prefix>/bin` on macOS/Linux, `<prefix>` on Windows) to your `PATH`.

**Permission errors during install** — npm's global prefix isn't writable.
Either point it somewhere you own:

```bash
npm config set prefix ~/.npm-global   # then add ~/.npm-global/bin to PATH
```

or prefix the install with `sudo` on macOS/Linux.

</details>

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
