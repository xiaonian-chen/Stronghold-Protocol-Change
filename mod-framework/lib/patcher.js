// mod-framework/lib/patcher.js
// Unified-diff generator, parser, and applier.
// Uses a patience-diff approach: match unique line pairs, LIS on b-positions,
// then fill the gaps as hunks.  No external dependencies.

import fs from 'node:fs';

// ── Public API ──────────────────────────────────────────────────────

/** Generate a unified diff (patch text) from two file paths. */
export function generatePatchFile(originalPath, modifiedPath, label) {
  const original = fs.readFileSync(originalPath, 'utf-8');
  const modified = fs.readFileSync(modifiedPath, 'utf-8');
  return generatePatch(original, modified, label);
}

/** Generate a unified diff (patch text) from two strings. */
export function generatePatch(original, modified, label) {
  const a = original.split('\n');
  const b = modified.split('\n');
  const hunks = computeHunks(a, b, 3);
  if (hunks.length === 0) return '';
  let out = `--- a/${label}\n+++ b/${label}\n`;
  for (const h of hunks) {
    out += `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@\n`;
    for (const line of h.lines) out += line + '\n';
  }
  return out;
}

/** Parse unified-diff text into an array of hunk objects. */
export function parsePatch(patchText) {
  const hunks = [];
  const re = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  let cur = null;
  for (const line of patchText.split('\n')) {
    const m = line.match(re);
    if (m) {
      cur = {
        oldStart: parseInt(m[1]),
        oldCount: m[2] !== undefined ? parseInt(m[2]) : 1,
        newStart: parseInt(m[3]),
        newCount: m[4] !== undefined ? parseInt(m[4]) : 1,
        lines: [],
      };
      hunks.push(cur);
    } else if (cur) {
      if (line === '\\ No newline at end of file') continue;
      cur.lines.push(line);
    }
  }
  return hunks;
}

/**
 * Apply a patch to source text.
 * @returns {{ success: boolean, result: string|null, error: string|null }}
 */
export function applyPatch(source, patchText) {
  const hunks = parsePatch(patchText);
  if (hunks.length === 0) return { success: true, result: source, error: null };

  const lines = source.split('\n');
  let offset = 0;

  for (const hunk of hunks) {
    const r = applyOneHunk(lines, hunk, offset);
    if (!r.ok) {
      return {
        success: false,
        result: null,
        error: `hunk @@ -${hunk.oldStart},${hunk.oldCount}: ${r.reason}`,
      };
    }
    offset += hunk.newCount - hunk.oldCount;
  }

  return { success: true, result: lines.join('\n'), error: null };
}

/** Check whether a patch applies cleanly. */
export function canApply(source, patchText) {
  return applyPatch(source, patchText).success;
}

/**
 * Parse a .patch file that has a metadata header.
 * Header lines start with "# key: value".
 */
export function parsePatchFile(content) {
  const lines = content.split('\n');
  const meta = {};
  let i = 0;
  while (i < lines.length && lines[i].startsWith('#')) {
    const m = lines[i].match(/^#\s*([\w-]+)\s*:\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
    i++;
  }
  return { meta, patch: lines.slice(i).join('\n') };
}

// ── Hunk application ────────────────────────────────────────────────

function applyOneHunk(lines, hunk, offset) {
  let idx = hunk.oldStart - 1 + offset;
  for (const raw of hunk.lines) {
    const op = raw[0];
    const text = raw.slice(1);
    switch (op) {
      case ' ':
        if (idx >= lines.length || lines[idx] !== text) {
          return { ok: false, reason: `ctx mismatch at L${idx + 1} expected "${trunc(text)}"` };
        }
        idx++;
        break;
      case '-':
        if (idx >= lines.length || lines[idx] !== text) {
          return { ok: false, reason: `del mismatch at L${idx + 1} expected "${trunc(text)}"` };
        }
        lines.splice(idx, 1);
        break;
      case '+':
        lines.splice(idx, 0, text);
        idx++;
        break;
    }
  }
  return { ok: true };
}

// ── Diff computation (patience-diff) ────────────────────────────────

function computeHunks(a, b, ctx) {
  const matches = uniqueLineMatches(a, b);
  if (matches.length === 0) {
    return [buildHunk(a, b, 0, a.length, 0, b.length, ctx)];
  }

  const hunks = [];
  let aPos = 0, bPos = 0;
  for (const [ma, mb] of matches) {
    if (aPos < ma || bPos < mb) {
      hunks.push(buildHunk(a, b, aPos, ma, bPos, mb, ctx));
    }
    aPos = ma + 1;
    bPos = mb + 1;
  }
  if (aPos < a.length || bPos < b.length) {
    hunks.push(buildHunk(a, b, aPos, a.length, bPos, b.length, ctx));
  }
  return hunks;
}

function uniqueLineMatches(a, b) {
  const idx = new Map();
  for (let i = 0; i < a.length; i++) {
    const line = a[i];
    if (!idx.has(line)) idx.set(line, []);
    idx.get(line).push(i);
  }
  const pairs = [];
  for (let j = 0; j < b.length; j++) {
    const pos = idx.get(b[j]);
    if (pos && pos.length === 1) pairs.push([pos[0], j]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  return longestIncreasingSubseq(pairs);
}

function longestIncreasingSubseq(pairs) {
  if (pairs.length === 0) return [];
  const piles = [];
  const prev = new Array(pairs.length);
  for (let i = 0; i < pairs.length; i++) {
    const val = pairs[i][1];
    let lo = 0, hi = piles.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[piles[mid]][1] < val) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = piles[lo - 1];
    piles[lo] = i;
  }
  const result = [];
  let cur = piles[piles.length - 1];
  while (cur !== undefined) {
    result.unshift(pairs[cur]);
    cur = prev[cur];
  }
  return result;
}

function buildHunk(a, b, aStart, aEnd, bStart, bEnd, ctx) {
  const ctxStart = Math.max(0, aStart - ctx);
  const ctxEnd = Math.min(a.length, aEnd + ctx);
  const lines = [];
  for (let i = ctxStart; i < aStart; i++) lines.push(' ' + a[i]);
  for (let i = aStart; i < aEnd; i++) lines.push('-' + a[i]);
  for (let i = bStart; i < bEnd; i++) lines.push('+' + b[i]);
  for (let i = aEnd; i < ctxEnd; i++) lines.push(' ' + a[i]);

  const oldCount = lines.filter(l => l[0] === ' ' || l[0] === '-').length;
  const newCount = lines.filter(l => l[0] === ' ' || l[0] === '+').length;
  return { oldStart: ctxStart + 1, oldCount, newStart: ctxStart + 1, newCount, lines };
}

function trunc(s, n = 60) {
  return s.length <= n ? s : s.slice(0, n) + '…';
}