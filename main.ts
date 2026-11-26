// Token Launch Radar — entry for make.fun's token-radar-01 bounty.
//
// The program reads the sealed DefiLlama snapshot (every protocol with TVL
// >= $5M as of 2026-11-14), values each protocol that records no token with
// the Launch Multiple model in lib/model.ts — the median market-cap/TVL
// ratio its own category's traded protocols reveal, adjusted for momentum,
// chain breadth and time run tokenless, with the plausible range its
// category's quartile ratios imply and a leave-one-out calibration of that
// range against the traded protocols themselves — ranks them, and writes
// the board to board.json. It then writes the dashboard's data.js from the
// same board, copies this repository's dashboard/ and screenshots/ into
// the output, and writes dossier.json last with the vendored
// buildDossier, so the file the judge reads is exactly what the scorer
// rebuilds.
//
// Run: node main.ts [--input <snapshot.json|dir>] [--output <dir>]
// In the grader the snapshot is at /input/snapshot.json and the output
// defaults to /output (or $MAKEFUN_OUTPUT_DIR). Locally the kit's snapshot
// is the fallback so the program can be exercised end to end. One local
// concession: board.json and data.js are written before the screenshot
// check, so a first local pass can produce the data the dashboard renders
// for its screenshots; in the grader the screenshots are committed in the
// repository and the check passes on the same run.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps, as the starter states them: the text cap shapes the
 *  dossier's bytes; the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read a `--flag value` or `--flag=value` argument, else the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && process.argv[at + 1]) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : fallback;
}

/** Locate the snapshot: explicit argument first, then the grader's mount,
 *  then the dev kit's copy beside this workspace for local runs. */
function snapshotPath(): string {
  const given = flag('input', '');
  const candidates = [
    given ? (given.endsWith('.json') ? given : join(given, 'snapshot.json')) : '',
    '/input/snapshot.json',
    join(process.env.HOME ?? '', 'workspace/makefun/token-radar/token-radar-01-kit/input/snapshot.json'),
  ].filter((c) => c.length > 0);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`no snapshot found; tried ${candidates.join(', ')}`);
}

/** Copy one directory's regular files into `to`, skipping dot names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

function main(): void {
  const snapshot = parseSnapshot(readFileSync(snapshotPath(), 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: refusing to write the board: ${issue}\n`);
    process.exit(1);
  }
  const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(outDir, 'data.js'), dataScript(radar));

  const page = copyFiles(join(here, 'dashboard'), join(outDir, 'dashboard'));
  const shots = copyFiles(join(here, 'screenshots'), join(outDir, 'screenshots'));
  if (page.length === 0) {
    process.stderr.write('token radar: dashboard/ is empty: the page is part of the entry\n');
    process.exit(1);
  }
  if (shots.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} image(s): hand in 3 — the board, a detail view and a filtered view (board.json and data.js are already written, so the page can be rendered now)\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }

  // The dossier is written last: the scorer rebuilds it from this output
  // and compares bytes, so nothing may be written to the output after it.
  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
  );
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ${board.length} rows; ` +
      `top row ${board[0]!.slug} at $${board[0]!.implied_value_usd}; wrote board.json, data.js, dashboard/ (${page.length} files), ` +
      `screenshots/ (${shots.length} images) and dossier.json in ${outDir}\n`,
  );
}

main();
