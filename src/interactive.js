import readline from 'node:readline';
import { makeColors } from './report.js';

export class InteractiveError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InteractiveError';
  }
}

const KEY_HINTS = '↑/↓ move · space select · a all · / filter · enter confirm · q cancel';

function truncate(text, width) {
  if (width <= 1 || text.length <= width) return text;
  return `${text.slice(0, width - 1)}…`;
}

function locationOf(candidate, remote) {
  if (candidate.local && candidate.remote) return `local + ${remote}`;
  if (candidate.local) return 'local only';
  return `${remote} only`;
}

/**
 * Full-screen-free branch picker: draws a frame, redraws it in place on each
 * keypress, and leaves a one-line summary behind when it exits.
 *
 * Resolves to an array of branch names, or null if the user cancelled.
 * `candidates` are `{ name, local, remote, merged }`.
 */
export function selectBranches({
  candidates,
  target,
  remote = 'origin',
  preselected = [],
  input = process.stdin,
  output = process.stderr,
}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new InteractiveError(
      'Interactive mode (-i) needs an interactive terminal on stdin. Pass branch names as arguments instead.',
    );
  }
  if (candidates.length === 0) {
    throw new InteractiveError(`No branches available to merge into "${target}".`);
  }

  const colors = makeColors(output);
  const names = new Set(candidates.map((c) => c.name));
  const selected = new Set(preselected.filter((name) => names.has(name)));
  const nameWidth = Math.min(44, candidates.reduce((max, c) => Math.max(max, c.name.length), 0));

  let cursor = 0;
  let query = '';
  let filtering = false;
  let renderedLines = 0;

  function matching() {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.name.toLowerCase().includes(q));
  }

  function clampCursor(list) {
    cursor = list.length === 0 ? 0 : Math.max(0, Math.min(cursor, list.length - 1));
  }

  function buildFrame() {
    const list = matching();
    clampCursor(list);

    const rows = [];
    const count = selected.size === 0 ? 'none selected' : `${selected.size} selected`;
    rows.push({
      text: `Select branches to merge into "${target}"  (${count})`,
      style: colors.bold,
    });
    if (filtering) {
      rows.push({ text: `filter: ${query}█`, style: colors.cyan });
    } else if (query) {
      rows.push({ text: `filter: ${query}`, style: colors.cyan });
    } else {
      rows.push({ text: '' });
    }
    rows.push({ text: '' });

    if (list.length === 0) {
      rows.push({ text: '  no branches match the filter', style: colors.dim });
    } else {
      const maxVisible = Math.max(3, (output.rows || 24) - 6);
      let start = 0;
      if (list.length > maxVisible) {
        start = Math.min(
          Math.max(0, cursor - Math.floor(maxVisible / 2)),
          list.length - maxVisible,
        );
      }
      const end = Math.min(list.length, start + maxVisible);

      if (start > 0) {
        rows.push({ text: `    ↑ ${start} more`, style: colors.dim });
      }
      for (let i = start; i < end; i++) {
        const c = list[i];
        const marker = i === cursor ? '❯' : ' ';
        const box = selected.has(c.name) ? '[x]' : '[ ]';
        const note = c.merged
          ? `${locationOf(c, remote)} · already merged`
          : locationOf(c, remote);
        const text = `  ${marker} ${box} ${c.name.padEnd(nameWidth)}  ${note}`;
        let style;
        if (i === cursor) style = colors.cyan;
        else if (c.merged) style = colors.dim;
        rows.push({ text, style });
      }
      if (end < list.length) {
        rows.push({ text: `    ↓ ${list.length - end} more`, style: colors.dim });
      }
    }

    rows.push({ text: '' });
    rows.push({ text: `  ${KEY_HINTS}`, style: colors.dim });
    return rows;
  }

  function paint(rows) {
    const width = (output.columns || 80) - 1;
    const body = rows
      .map(({ text, style }) => {
        const clipped = truncate(text, width);
        return style ? style(clipped) : clipped;
      })
      .join('\n');
    const rewind = renderedLines > 0 ? `\x1b[${renderedLines}A\r\x1b[J` : '';
    output.write(`${rewind}${body}\n`);
    renderedLines = rows.length;
  }

  function render() {
    paint(buildFrame());
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const onResize = () => {
      // The frame we last drew may have wrapped differently; start a fresh one.
      renderedLines = 0;
      output.write('\x1b[2J\x1b[H');
      render();
    };

    function teardown() {
      input.removeListener('keypress', onKeypress);
      output.removeListener('resize', onResize);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      output.write('\x1b[?25h');
    }

    function finish(result, trailer) {
      if (settled) return;
      settled = true;
      const rewind = renderedLines > 0 ? `\x1b[${renderedLines}A\r\x1b[J` : '';
      output.write(`${rewind}${trailer}\n`);
      renderedLines = 0;
      teardown();
      resolve(result);
    }

    function confirm() {
      const chosen = candidates.map((c) => c.name).filter((name) => selected.has(name));
      if (chosen.length === 0) {
        finish([], colors.dim('No branches selected.'));
        return;
      }
      finish(chosen, `Selected ${chosen.length}: ${chosen.join(', ')}`);
    }

    function move(delta) {
      const list = matching();
      if (list.length === 0) return;
      cursor = (cursor + delta + list.length) % list.length;
    }

    function onKeypress(str, key = {}) {
      if (settled) return;

      if (key.ctrl && key.name === 'c') {
        finish(null, colors.dim('Cancelled.'));
        return;
      }

      if (filtering) {
        if (key.name === 'return' || key.name === 'enter') {
          filtering = false;
        } else if (key.name === 'escape') {
          filtering = false;
          query = '';
        } else if (key.name === 'backspace') {
          query = query.slice(0, -1);
        } else if (key.name === 'up') {
          move(-1);
        } else if (key.name === 'down') {
          move(1);
        } else if (str && !key.ctrl && !key.meta && str >= ' ' && str !== '\x7f') {
          query += str;
          cursor = 0;
        }
        render();
        return;
      }

      switch (key.name) {
        case 'up':
          move(-1);
          break;
        case 'down':
          move(1);
          break;
        case 'pageup':
          move(-Math.max(3, (output.rows || 24) - 8));
          break;
        case 'pagedown':
          move(Math.max(3, (output.rows || 24) - 8));
          break;
        case 'home':
          cursor = 0;
          break;
        case 'end':
          cursor = Math.max(0, matching().length - 1);
          break;
        case 'space': {
          const list = matching();
          const current = list[cursor];
          if (current) {
            if (selected.has(current.name)) selected.delete(current.name);
            else selected.add(current.name);
            if (cursor < list.length - 1) cursor++;
          }
          break;
        }
        case 'return':
        case 'enter':
          confirm();
          return;
        case 'escape':
          if (query) {
            query = '';
            break;
          }
          finish(null, colors.dim('Cancelled.'));
          return;
        default: {
          if (str === '/') {
            filtering = true;
            break;
          }
          if (str === 'a' || str === 'A') {
            const list = matching();
            const allSelected = list.length > 0 && list.every((c) => selected.has(c.name));
            for (const c of list) {
              if (allSelected) selected.delete(c.name);
              else selected.add(c.name);
            }
            break;
          }
          if (str === 'j') {
            move(1);
            break;
          }
          if (str === 'k') {
            move(-1);
            break;
          }
          if (str === 'q') {
            finish(null, colors.dim('Cancelled.'));
            return;
          }
          return;
        }
      }
      render();
    }

    try {
      readline.emitKeypressEvents(input);
      input.setRawMode(true);
      input.resume();
      output.write('\x1b[?25l');
      input.on('keypress', onKeypress);
      output.on('resize', onResize);
      render();
    } catch (err) {
      teardown();
      reject(err);
    }
  });
}
