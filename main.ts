// Token Launch Radar — an original entry for make.fun's token-radar-01 bounty.
//
// What this program does, in one paragraph: it reads the sealed DefiLlama
// snapshot (every protocol with TVL >= $5M as of 2026-11-14), works out what a
// token launch would plausibly be worth for each protocol that does not have a
// token yet, ranks those protocols by that implied value, and writes the
// ranked board to board.json together with a concrete farm plan per protocol.
//
// The valuation is not a single magic multiple. The snapshot itself contains
// hundreds of protocols that already trade, and for each category they reveal
// the market's own price for one dollar of TVL: the median market-cap / TVL
// ratio inside the category. A pre-token protocol is valued with its own
// category's observed multiple, then adjusted for three things the snapshot
// also measures — its 7-day TVL momentum, how many chains it runs on, and how
// long it has operated without a token. No protocol name is ever looked up or
// special-cased; the same arithmetic scores every row.
//
// Run: node main.ts [--input <snapshot.json|dir>] [--output <dir>]
// In the grader the snapshot is at /input/snapshot.json and output defaults
// to /output (or $MAKEFUN_OUTPUT_DIR). Locally the kit's snapshot is used as
// a fallback so the program can be exercised end to end.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** One protocol record, exactly the ten fields the sealed snapshot carries. */
interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document: metadata, the protocol universe, the watchlist. */
interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** One row of the board this program writes. */
interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  implied_value_usd: number;
  farm_steps: string[];
}

const DAY_MS = 86_400_000;
const MAX_ROWS = 240;

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

/** Parse and lightly validate the snapshot text. */
function loadSnapshot(path: string): Snapshot {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot is missing its protocols or watchlist arrays');
  }
  return raw;
}

/** Median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The market's own TVL multiples: median mcap/TVL per category among the
 *  protocols that already trade, plus one global median as the fallback for
 *  categories with too few traded members to trust. */
function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, number>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const ratio = p.mcap_usd / p.tvl_usd;
      if (ratio > 0.01 && ratio < 100) {
        all.push(ratio);
        const key = p.category ?? 'Uncategorised';
        const bucket = ratios.get(key) ?? [];
        bucket.push(ratio);
        ratios.set(key, bucket);
      }
    }
  }
  const global = all.length > 0 ? median(all) : 0.25;
  const byCategory = new Map<string, number>();
  for (const [key, bucket] of ratios) {
    if (bucket.length >= 3) {
      // Shrinkage: a category priced by only a handful of traded protocols is
      // pulled toward the global median in proportion to its sample size, so
      // three lucky listings cannot triple a whole category's valuations.
      const n = bucket.length;
      byCategory.set(key, (n * median(bucket) + 3 * global) / (n + 3));
    }
  }
  return { byCategory, global };
}

/** Whole days between the protocol's listing date and the snapshot date. */
function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol has no token when the snapshot records no cap, id or symbol. */
function hasNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Protocols the board may rank: tokenless, not an exchange, not a versioned
 *  pool of some parent protocol. */
function rankable(p: Protocol): boolean {
  return hasNoToken(p) && p.category !== 'CEX' && !VERSION_SUFFIX.test(p.name);
}

/** The implied launch value of one pre-token protocol, with its workings. */
function impliedValue(
  p: Protocol,
  asOf: string,
  multiples: { byCategory: Map<string, number>; global: number },
): number {
  const multiple = multiples.byCategory.get(p.category ?? 'Uncategorised') ?? multiples.global;
  // Momentum: the snapshot's 7-day TVL change is a percentage; reward growth,
  // discount shrinkage, and clamp both so one wild week cannot dominate.
  const pct = Math.min(80, Math.max(-40, p.change_7d ?? 0));
  const momentum = 1 + (pct / 100) * 0.35;
  // Breadth: each additional chain is distribution a launch can use, capped.
  const breadth = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 6);
  // Maturity: a protocol that has run longer without a token has more pent-up
  // launch value, rising over three years; unknown age counts as one year.
  const age = ageInDays(asOf, p.listed_at) ?? 365;
  const maturity = 0.7 + 0.3 * (Math.min(age, 1095) / 1095);
  return Math.max(1, Math.round(p.tvl_usd * multiple * momentum * breadth * maturity));
}

/** The chain a farm plan should start on. */
function homeChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Capital a farm position needs, scaled to the protocol's size. */
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The opening move of a farm plan, chosen by the protocol's category. */
function openingMove(p: Protocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  const chain = homeChain(p);
  if (c.includes('lend') || c.includes('cdp')) return `Supply $${capital} of USDC as collateral to ${p.name} on ${chain} and leave the position open`;
  if (c.includes('dex') || c.includes('yield')) return `Add $${capital} of liquidity to the main ${p.name} pool on ${chain} and keep the LP position open`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${p.name}, then use the bridged funds in one of its routes`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the base asset through ${p.name} on ${chain} and hold the staking receipt`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC margin on ${p.name} and open one small hedged position`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield asset ${p.name} offers on ${chain} and hold it in the farming wallet`;
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open`;
}

/** How long a farm position should be held: younger protocols qualify
 *  farmers over a longer window, established ones reward consistency sooner. */
function holdDays(p: Protocol, asOf: string): number {
  const age = ageInDays(asOf, p.listed_at);
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Five concrete steps per protocol, each with its cost and its time. */
function farmPlan(p: Protocol, asOf: string): string[] {
  const capital = capitalFor(p);
  const chain = homeChain(p);
  const hold = holdDays(p, asOf);
  return [
    `Set up one fresh wallet for ${p.name} only, fund it with $${capital + 20} on ${chain}, and store its seed phrase offline. Cost: about $3 in gas to fund. Time: 10 minutes.`,
    `${openingMove(p, capital)}. Cost: $${capital} of working capital plus roughly $5 of gas. Time: 15 minutes to set up.`,
    `Repeat one small qualifying action on ${p.name} every week — a deposit top-up, a swap, a borrow or a vote — so the wallet reads as an active user, not a one-off. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so it appears in several weekly snapshots, and check the position weekly for health and rewards. Cost: the $${capital} stays committed. Time: ${hold} days, 5 minutes a week.`,
    `Keep a farm log with the wallet address, dates and transaction hashes, and only ever claim rewards from links on the protocol's own site. Cost: nothing. Time: 5 minutes per entry.`,
  ];
}

/** Build the ranked board: every watchlist slug, plus the strongest other
 *  rankable pre-token protocols by implied value, capped at MAX_ROWS. */
function buildBoard(snapshot: Snapshot): Row[] {
  const multiples = categoryMultiples(snapshot);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) picked.set(slug, p);
  }
  const rest = snapshot.protocols
    .filter((p) => !picked.has(p.slug) && rankable(p))
    .map((p) => ({ p, value: impliedValue(p, snapshot.as_of, multiples) }))
    .sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  for (const { p } of rest) {
    if (picked.size >= MAX_ROWS) break;
    picked.set(p.slug, p);
  }
  const scored = [...picked.values()].map((p) => ({ p, value: impliedValue(p, snapshot.as_of, multiples) }));
  scored.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map(({ p, value }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    implied_value_usd: value,
    farm_steps: farmPlan(p, snapshot.as_of),
  }));
}

/** Refuse to write a board the gate would reject; returns why, or null. */
function boardProblem(board: Row[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i} carries rank ${row.rank}`;
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${row.slug} is out of value order`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${row.slug} has a bad implied value`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return `row ${row.slug} has a farm step of ${step.length} chars`;
    }
  }
  return null;
}

function main(): void {
  const snapshot = loadSnapshot(snapshotPath());
  const board = buildBoard(snapshot);
  const problem = boardProblem(board, snapshot);
  if (problem) {
    process.stderr.write(`token radar: refusing to write the board: ${problem}\n`);
    process.exit(1);
  }
  const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ${board.length} rows; ` +
      `top row ${board[0]!.slug} at $${board[0]!.implied_value_usd}; wrote ${join(outDir, 'board.json')}\n`,
  );
}

main();
