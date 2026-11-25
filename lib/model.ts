// The Launch Multiple model (version launch-multiple-2) for token-radar-01.
//
// The idea, in plain words. The snapshot holds 758 protocols; 129 of them
// already trade, and for those the market has published its own answer to
// "what is one dollar of TVL worth here?" — the ratio of market cap to TVL.
// Protocols still to launch are priced with the median of that ratio inside
// their own category, shrunk toward the global median (0.275 on this
// snapshot) when a category has only a few traded members to learn from.
// That base is then adjusted by three more figures the snapshot itself
// carries: the protocol's 7-day TVL momentum, the number of chains it runs
// on (distribution a launch can use), and how long it has already operated
// with no token recorded (pent-up launch value, rising over three years).
//
// Who may be ranked follows the house's own watchlist rule, applied at
// every TVL, not just above the $50M floor: a protocol records no token
// (both gecko_id and symbol null), its category is not Bridge, Canonical
// Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name
// ends in no version marker, carries no whole word wrapped, staked or
// staking, and does not begin with an exchange's name. That rule is what
// keeps WBTC, Binance staked ETH and USDT0 — wrapped or staked products of
// tokens that already trade — off the board even though the snapshot
// records no token for them. No protocol name is ever special-cased beyond
// that stated rule; the same arithmetic scores every row.

/** One protocol record: exactly the ten fields the sealed snapshot carries. */
export interface Protocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's stated version, shown on the dashboard. */
export const MODEL_VERSION = 'launch-multiple-2';

/** How many already-trading protocols the dashboard sets aside for contrast. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

/** Categories the house rule treats as wrapped/staked/bridged products. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name ending in a release marker is a pool of some parent protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product of another token. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names beginning with an exchange's name are that exchange's product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A protocol records no token when the snapshot carries neither id nor symbol. */
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank this protocol, by the house's watchlist rule. */
export function rankable(p: Protocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One category's learned multiple, with the evidence behind it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  samples: number;
}

/** The market's TVL multiples, learned from the snapshot's traded protocols.
 *  A category needs at least three traded members to earn its own multiple,
 *  and even then it is shrunk toward the global median in proportion to its
 *  sample size, so a handful of lucky listings cannot reprice a category. */
export function learnMultiples(snapshot: Snapshot): { byCategory: Map<string, CategoryMultiple>; global: number } {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const ratio = p.mcap_usd / p.tvl_usd;
      if (ratio < 0.01 || ratio > 100) continue;
      all.push(ratio);
      const key = p.category ?? 'Uncategorised';
      const bucket = ratios.get(key) ?? [];
      bucket.push(ratio);
      ratios.set(key, bucket);
    }
  }
  const global = all.length > 0 ? median(all) : 0.25;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [key, bucket] of ratios) {
    if (bucket.length >= 3) {
      const n = bucket.length;
      byCategory.set(key, { category: key, multiple: (n * median(bucket) + 3 * global) / (n + 3), samples: n });
    }
  }
  return { byCategory, global };
}

/** Whole days between DefiLlama's first tracking day and the snapshot date. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The workings of one protocol's valuation, kept so the page can show them. */
export interface Workings {
  multiple: number;
  multiple_source: string;
  momentum: number;
  breadth: number;
  maturity: number;
  age_days: number | null;
}

/** Value one rankable protocol, returning the figure and its workings. */
export function valueOf(
  p: Protocol,
  asOf: string,
  learned: { byCategory: Map<string, CategoryMultiple>; global: number },
): { value: number; workings: Workings } {
  const learnedFor = learned.byCategory.get(p.category ?? 'Uncategorised');
  const multiple = learnedFor ? learnedFor.multiple : learned.global;
  const multipleSource = learnedFor
    ? `median of ${learnedFor.samples} traded ${learnedFor.category} protocols, shrunk to the global median`
    : 'the global median multiple (too few traded protocols in this category to learn one)';
  // Momentum: reward a growing TVL, discount a shrinking one, clamp both so
  // a single wild week cannot dominate a launch valuation.
  const pct = Math.min(80, Math.max(-40, p.change_7d ?? 0));
  const momentum = 1 + (pct / 100) * 0.35;
  // Breadth: each extra chain is distribution a launch can use, capped at 6.
  const breadth = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 6);
  // Maturity: value pent up over a long tokenless run, rising over 3 years.
  const age = ageInDays(asOf, p.listed_at);
  const maturity = 0.7 + 0.3 * (Math.min(age ?? 365, 1095) / 1095);
  const value = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * breadth * maturity));
  return {
    value,
    workings: {
      multiple: round4(multiple),
      multiple_source: multipleSource,
      momentum: round4(momentum),
      breadth: round4(breadth),
      maturity: round4(maturity),
      age_days: age,
    },
  };
}

/** Gas tier of a chain, for honest farm costs: mainnet is dear, rollups are
 *  cents, and anything unlisted is priced as an ordinary sidechain. */
function gasFor(chain: string): { label: string; swap: number; action: number } {
  if (chain === 'Ethereum') return { label: 'Ethereum mainnet gas', swap: 9, action: 12 };
  if (chain === 'Solana') return { label: 'Solana fees', swap: 0.1, action: 0.1 };
  const rollups = ['Base', 'Arbitrum', 'Optimism', 'Linea', 'Scroll', 'zkSync Era', 'Mantle', 'Ink', 'Soneium', 'Metis', 'Blast', 'Mode', 'Zora', 'Robinhood Chain', 'MegaETH', 'X Layer', 'Plasma', 'Monad'];
  if (rollups.includes(chain)) return { label: `${chain} rollup gas`, swap: 0.3, action: 0.5 };
  const cheap = ['Binance', 'Polygon', 'Avalanche', 'Fantom', 'Sonic', 'Tron', 'Algorand', 'Stellar', 'Sui', 'Flare', 'Plume Mainnet', 'Berachain', 'Celo', 'xDai', 'Arc', 'Pharos'];
  if (cheap.includes(chain)) return { label: `${chain} fees`, swap: 0.5, action: 1 };
  return { label: `${chain} fees`, swap: 1, action: 2 };
}

/** Capital a farm position needs, scaled to the protocol's own size. */
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long a position should be held: younger protocols qualify farmers
 *  over a longer window; established ones reward consistency sooner. */
function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core farming action, in words a farmer can follow. */
function coreAction(p: Protocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${n} curated vault on ${chain}; the curator allocates it across lending markets and the shares are your position`;
  if (c.includes('lend') || c.includes('cdp')) return `Supply $${capital} of USDC as collateral to ${n} on ${chain}, borrow no more than 40% against it, and keep the health factor above 1.6`;
  if (c.includes('dex')) return `Add $${capital} split evenly between USDC and the main pair asset in ${n}'s highest-volume pool on ${chain}, inside the default range`;
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity')) return `Deposit $${capital} of USDC into ${n}'s main yield vault on ${chain} and leave auto-compounding switched on`;
  if (c.includes('restak') || c.includes('staking pool') || c === 'staking') return `Stake $${capital} of the chain's base asset through ${n} on ${chain} and keep the staking receipt token in the same wallet`;
  if (c.includes('rwa')) return `Mint $${capital} of the tokenised real-world asset ${n} issues on ${chain} and hold it; check its redemption window before you need the money back`;
  if (c.includes('stable') || c.includes('algo-stable') || c.includes('dual-token')) return `Mint $${capital} of ${n}'s stable asset on ${chain} against USDC collateral and hold the minted asset, watching the peg weekly`;
  if (c.includes('basis') || c.includes('cede')) return `Fund $${capital} of USDC margin on ${n} on ${chain}; its basis book does the hedging, so make no manual trades against it`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option')) return `Deposit $${capital} of USDC margin on ${n} and open one small delta-neutral position (long spot, short perp of the same size)`;
  if (c.includes('prediction')) return `Fund $${capital} and take small positions in ${n}'s three most liquid markets on ${chain}, never more than $${Math.round(capital / 5)} in one market`;
  if (c.includes('insurance')) return `Buy $${capital} of protocol cover from ${n} on ${chain} for assets you already hold elsewhere, and keep the policy NFT in the wallet`;
  if (c.includes('payment')) return `Route one real payment of about $${Math.round(capital / 2)} through ${n} on ${chain} each month, so the wallet shows genuine payment history`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} through ${n}'s canonical route and make one swap there, so the wallet is an early ${chain} user`;
  if (c.includes('governance') || c.includes('incentive')) return `Deposit $${capital} of USDC into ${n} on ${chain} and vote in its next two governance rounds from the same wallet`;
  if (c.includes('index')) return `Buy $${capital} of ${n}'s main index basket on ${chain} and hold every component in proportion`;
  if (c.includes('launchpad')) return `Register the wallet on ${n} and join one sale or staking round with $${capital} on ${chain}`;
  if (c.includes('privacy')) return `Make one shielded deposit of $${capital} into ${n} on ${chain} and one shielded withdrawal to the same wallet a week later`;
  if (c.includes('collateral') || c.includes('synthetic')) return `Post $${capital} of USDC as collateral in ${n} on ${chain} and mint or hold the synthetic it backs at a conservative ratio`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its own app and keep the position open`;
}

/** The weekly habit that keeps a farm wallet reading as a real user. */
function weeklyAction(p: Protocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'repay a slice of the borrow and borrow it back, or top the collateral up by $5';
  if (c.includes('dex') || c.includes('yield') || c.includes('liquidity')) return 'harvest the accrued fees or rewards and restake them into the same position';
  if (c.includes('restak') || c.includes('staking')) return 'claim the staking rewards and restake them from the same wallet';
  if (c.includes('derivative') || c.includes('basis')) return 'check the hedge is still balanced and rebalance it if the two legs drift apart';
  if (c.includes('prediction')) return 'settle any finished market and place one new small position';
  return 'make one small deposit top-up of $5, or withdraw and redeposit $5, through the protocol\u2019s own app';
}

/** Six concrete farm steps per protocol, each carrying its cost and time.
 *  Costs use the home chain's real gas tier; times and holds use its age. */
export function farmPlan(p: Protocol, asOf: string): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDays(ageInDays(asOf, p.listed_at));
  const weekly = weeklyAction(p);
  return [
    `Create one fresh wallet for ${p.name} alone, fund it with $${capital + 25} on ${chain}, and write the seed phrase on paper, never in a screenshot. Cost: about $${gas.action} of ${gas.label} to make the first transaction. Time: 10 minutes.`,
    `${coreAction(p, capital, chain)}. Cost: $${capital} of working capital plus about $${gas.action} of ${gas.label}. Time: 15 minutes to set up, 5 minutes to check the receipt.`,
    `Every week, ${weekly}. Cost: about $${gas.swap} of ${gas.label} a week. Time: 10 minutes a week.`,
    `Hold the position untouched for at least ${hold} days so it appears in several weekly TVL snapshots, and glance at it weekly for health warnings. Cost: the $${capital} stays committed for the whole ${hold} days. Time: 5 minutes a week.`,
    `Open ${p.name}'s own points, rewards or governance page and link this wallet there if it offers one; claim only from links on that page, never from a search ad or a DM. Cost: nothing to check, and never pay a fee to claim. Time: 10 minutes.`,
    `Keep a farm log — wallet address, chain, dates, amounts, transaction hashes — and review it before adding a second protocol, so positions never blur together. Cost: nothing. Time: 5 minutes per entry.`,
  ];
}

/** One row of the board this program writes. */
export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  token_status: 'pre-token';
  implied_value_usd: number;
  model: Workings;
  farm_steps: string[];
}

/** One already-trading protocol, for the dashboard's contrast view. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: Row[];
  live: LiveRow[];
}

/** Build the board: every watchlist slug, plus every other protocol that
 *  passes the house rule, ranked by implied value. On this snapshot the
 *  rule admits 198 protocols, so the board is the whole rankable universe. */
export function buildRadar(snapshot: Snapshot): { board: Row[]; radar: RadarData } {
  const learned = learnMultiples(snapshot);
  const chosen = new Map<string, Protocol>();
  for (const p of snapshot.protocols) if (rankable(p)) chosen.set(p.slug, p);
  // Coverage is the gate's first row: a watchlist slug the rule somehow
  // missed is still carried (the watchlist is the floor, never a ceiling).
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p && !chosen.has(slug)) chosen.set(slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => ({ p, ...valueOf(p, snapshot.as_of, learned) }));
  scored.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const board: Row[] = scored.map(({ p, value, workings }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: workings.age_days,
    watchlist: watchlist.has(p.slug),
    token_status: 'pre-token',
    implied_value_usd: value,
    model: workings,
    farm_steps: farmPlan(p, snapshot.as_of),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : 0,
      change_7d: p.change_7d,
    }));
  const multiples = [...learned.byCategory.values()].sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: round4(learned.global),
    multiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the scored shape. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot is missing its protocols or watchlist arrays');
  }
  return raw;
}

/** Why a board is not one the gate will take, or null when it is clean. */
export function boardIssue(board: Row[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${i} carries rank ${row.rank}`;
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${row.slug} is out of value order`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${row.slug} has a bad implied value`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} has a farm step of ${len} chars`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
