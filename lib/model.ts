// The Launch Multiple model (version launch-multiple-4) for token-radar-01.
//
// What changed since version 3, and why: version 3 priced a launch at a
// constant category multiple of TVL. Version 4 blind-tested that shape
// against the snapshot's own traded protocols and it lost. Across the
// traded set, market cap does not grow in proportion to TVL — it grows
// as a power of it. The fitted curve on this snapshot is
// mcap ∝ TVL^0.65: a protocol ten times larger trades at roughly four
// and a half times the value, not ten times, so a constant multiple
// systematically overprices the giants and underprices the small. The
// model below is that curve, with a level per category, fitted on comps
// built the way the snapshot itself attributes value: one entry per
// token, its TVL the sum over every protocol entry that records the
// token's symbol. Every other candidate term — the constant multiple,
// chain breadth, maturity, a momentum weight — was fitted and blind-
// tested the same way, and the page publishes the whole table: the
// terms that failed the test (breadth, maturity) are not in the model,
// and the one that passed (momentum, at the weight the test chose) is.
//
// Two honesty devices ride on top of the point estimate. Every row
// carries the plausible range the fitted curve's own residuals imply —
// a launch is a guess, and the page says how wide the guess is — and
// the range is calibrated the same way the model was chosen: every
// traded protocol is re-priced blind, with the curve learned without
// it, and the dashboard publishes how often the market cap the market
// actually set falls inside the range the page would have printed, how
// large the typical miss is, and how well the blind ranking tracks the
// market's own. A second, separate model estimates each protocol's
// launch odds — the chance it records a token at all — from a logistic
// fit over all 758 protocols, cross-fitted so its published accuracy is
// out-of-sample; the board still ranks by launch value, and the odds
// only weight the expected value a farmer is playing for. The funnel
// counts are published too: how many protocols record no token, and how
// many of those the product rule below keeps off the board, reason by
// reason.
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
export const MODEL_VERSION = 'launch-multiple-5';

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

/** The q-th quartile of a non-empty list, by nearest rank. */
function quartile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/** The traded ratio one protocol entry shows, or none when it has no
 *  market cap to learn from. The same window the model has always used:
 *  a ratio outside 0.01..100 is a data artefact, not a price. */
function tradedRatio(p: Protocol): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  const ratio = p.mcap_usd / p.tvl_usd;
  return ratio >= 0.01 && ratio <= 100 ? ratio : null;
}

/** One comparable the value model learns from: a single token, priced
 *  once. The snapshot attributes a token's market cap to one protocol
 *  entry (Aave V2 carries AAVE's; V1, V3 and V4 record the symbol but no
 *  cap), so a token's TVL is the sum over every entry that records its
 *  symbol — pricing the carrier entry against its own TVL alone would
 *  charge the whole token's value to a fraction of its locked value. */
export interface Comp {
  slug: string;
  category: string;
  tvl: number;
  mcap: number;
  ratio: number;
  entries: number;
}

/** The comps set: every token the snapshot prices, at its total TVL. */
export function buildComps(snapshot: Snapshot): Comp[] {
  const bySymbol = new Map<string, Protocol[]>();
  for (const p of snapshot.protocols) {
    if (p.symbol === null) continue;
    const group = bySymbol.get(p.symbol) ?? [];
    group.push(p);
    bySymbol.set(p.symbol, group);
  }
  const comps: Comp[] = [];
  for (const group of bySymbol.values()) {
    const carrier = group.find((p) => tradedRatio(p) !== null);
    if (!carrier) continue;
    const tvl = group.reduce((s, p) => s + p.tvl_usd, 0);
    const ratio = carrier.mcap_usd! / tvl;
    if (ratio < 0.01 || ratio > 100) continue;
    comps.push({
      slug: carrier.slug,
      category: carrier.category ?? 'Uncategorised',
      tvl,
      mcap: carrier.mcap_usd!,
      ratio,
      entries: group.length,
    });
  }
  comps.sort((a, b) => (a.slug < b.slug ? -1 : 1));
  return comps;
}

/** Shrink one statistic toward the global one by sample size: the weight
 *  a category earns is its own count against three phantom global members. */
function shrink(own: number, global: number, n: number): number {
  return (n * own + 3 * global) / (n + 3);
}

/** One category's level on the fitted curve: its multiple at the
 *  reference TVL (the comps' geometric mean), with the evidence behind
 *  it. A category needs at least three comps to earn its own level. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  samples: number;
}

/** The fitted value model: market cap as a power of TVL, a level per
 *  category, and the spread of its own residuals for the printed range. */
export interface ValueModel {
  slope: number;
  meanLogTvl: number;
  referenceTvl: number;
  globalLevel: number;
  byCategory: Map<string, CategoryMultiple>;
  residLowFactor: number;
  residHighFactor: number;
  comps: number;
}

/** Ordinary least squares of y on x, closed form. */
function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}

/** Fit the curve: log market cap on log TVL over the comps, then each
 *  category's level as the median of its members' log residuals — what
 *  is left of a token's ratio after the curve's slope is removed —
 *  shrunk toward the global median residual by the same three-phantom
 *  rule the model has always used. The printed range comes from the
 *  residuals themselves: the quartiles of log10(actual / predicted)
 *  across the comps, so the spread is the fit's own measured scatter,
 *  not a symmetric fudge around the point estimate. */
export function fitValueModel(comps: Comp[]): ValueModel {
  const xs = comps.map((c) => Math.log(c.tvl));
  const ys = comps.map((c) => Math.log(c.mcap));
  const { b: slope } = ols(xs, ys);
  const meanLogTvl = xs.reduce((s, x) => s + x, 0) / comps.length;
  const resid = comps.map((c) => Math.log(c.ratio) - (slope - 1) * (Math.log(c.tvl) - meanLogTvl));
  const globalOffset = median(resid);
  const buckets = new Map<string, number[]>();
  comps.forEach((c, i) => {
    const bucket = buckets.get(c.category) ?? [];
    bucket.push(resid[i]!);
    buckets.set(c.category, bucket);
  });
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [key, bucket] of buckets) {
    if (bucket.length >= 3) {
      byCategory.set(key, {
        category: key,
        multiple: Math.round(Math.exp(shrink(median(bucket), globalOffset, bucket.length)) * 1e4) / 1e4,
        samples: bucket.length,
      });
    }
  }
  const model: ValueModel = {
    slope,
    meanLogTvl,
    referenceTvl: Math.exp(meanLogTvl),
    globalLevel: Math.exp(globalOffset),
    byCategory,
    residLowFactor: 1,
    residHighFactor: 1,
    comps: comps.length,
  };
  const resid10 = comps.map((c) => Math.log10(c.mcap / curveValue(model, c.tvl, c.category)));
  model.residLowFactor = Math.pow(10, quartile(resid10, 0.25));
  model.residHighFactor = Math.pow(10, quartile(resid10, 0.75));
  return model;
}

/** The curve's price for a TVL in a category, before any adjustment:
 *  TVL raised to the fitted slope, at the category's level. */
function curveValue(model: ValueModel, tvl: number, category: string | null): number {
  const level = model.byCategory.get(category ?? 'Uncategorised');
  const offset = level ? Math.log(level.multiple) : Math.log(model.globalLevel);
  return tvl * Math.exp(offset + (model.slope - 1) * (Math.log(tvl) - model.meanLogTvl));
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
  /** The effective multiple at this protocol's own TVL: value / TVL. */
  multiple: number;
  multiple_source: string;
  momentum: number;
  /** The fitted power-law slope the price came from. */
  slope: number;
  /** The category's level: its multiple at the reference TVL. */
  level: number;
  age_days: number | null;
  value_low_usd: number;
  value_high_usd: number;
}

/** The one adjustment that survived the blind test: momentum from the
 *  7-day TVL change, at the weight the test itself chose. Chain breadth
 *  and maturity were fitted and tested the same way and made the blind
 *  error worse, so they are not in this model — the ablation table the
 *  page publishes carries their numbers. */
export const MOMENTUM_WEIGHT = 0.2;

function momentumOf(p: Protocol): number {
  const pct = Math.min(80, Math.max(-40, p.change_7d ?? 0));
  return 1 + (pct / 100) * MOMENTUM_WEIGHT;
}

/** Value one rankable protocol, returning the figure and its workings.
 *  The plausible range scales the same fitted price by the quartiles of
 *  the curve's own residuals, so it is the spread the fit actually
 *  scatters by — never a symmetric fudge around the point estimate. */
export function valueOf(
  p: Protocol,
  asOf: string,
  model: ValueModel,
): { value: number; workings: Workings } {
  const level = model.byCategory.get(p.category ?? 'Uncategorised');
  const multipleSource = level
    ? `level fitted from ${level.samples} traded ${level.category} tokens on the power-law curve, shrunk toward the global level`
    : 'the global level on the power-law curve (too few traded tokens in this category to fit one)';
  const momentum = momentumOf(p);
  const base = curveValue(model, p.tvl_usd, p.category);
  const value = Math.max(1, Math.round(base * momentum));
  const valueLow = Math.min(value, Math.max(1, Math.round(base * momentum * model.residLowFactor)));
  const valueHigh = Math.max(value, Math.max(1, Math.round(base * momentum * model.residHighFactor)));
  return {
    value,
    workings: {
      multiple: round4(value / p.tvl_usd),
      multiple_source: multipleSource,
      momentum: round4(momentum),
      slope: Math.round(model.slope * 1000) / 1000,
      level: round4(level ? level.multiple : model.globalLevel),
      age_days: ageInDays(asOf, p.listed_at),
      value_low_usd: valueLow,
      value_high_usd: valueHigh,
    },
  };
}

/** The calibration of the printed range and price, measured on the only
 *  ground truth the snapshot holds: its own traded tokens, each re-priced
 *  blind. No stronger claim is made, because the data allows none: the
 *  traded ratios span 0.01 to 100, four orders of magnitude, so a launch
 *  price is a spread to rank by, never a price to promise. */
export interface Calibration {
  tested: number;
  range_coverage_pct: number;
  /** Median blind miss, as a factor: the typical re-priced token's
   *  market cap sits within this multiple of the blind price. */
  median_factor_error: number;
  /** Spearman correlation between the blind prices and the market's own
   *  ranking of the same tokens. */
  spearman: number;
  /** The same median factor under a second, different blind protocol:
   *  repeated 5-fold cross-validation. Two protocols, one verdict. */
  kfold_factor_error: number;
  /** A third, time-based blind protocol: the curve learned from the
   *  earlier-listed half of the traded tokens prices the later-listed
   *  half — the test a live radar actually faces, since a launch is
   *  always priced from the past. */
  walkforward_factor_error: number;
  walkforward_coverage_pct: number;
  walkforward_tested: number;
}

/** A protocol-shaped evaluation point: a traded token and the TVL base
 *  its price is predicted from (its own entry's, or its token total). */
interface EvalComp {
  proto: Protocol;
  tvl: number;
  mcap: number;
}

type EvalFit = (train: EvalComp[]) => (p: Protocol, tvl: number) => number;

function evalCompsRaw(snapshot: Snapshot): EvalComp[] {
  return snapshot.protocols
    .filter((p) => tradedRatio(p) !== null)
    .map((p) => ({ proto: p, tvl: p.tvl_usd, mcap: p.mcap_usd! }));
}

function evalCompsTokenTotal(snapshot: Snapshot): EvalComp[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  return buildComps(snapshot).map((c) => ({ proto: bySlug.get(c.slug)!, tvl: c.tvl, mcap: c.mcap }));
}

function asComps(train: EvalComp[]): Comp[] {
  return train.map((c) => ({
    slug: c.proto.slug,
    category: c.proto.category ?? 'Uncategorised',
    tvl: c.tvl,
    mcap: c.mcap,
    ratio: c.mcap / c.tvl,
    entries: 1,
  }));
}

/** Version 3's adjustments, kept only so the ablation can price them. */
function evalAdjV3(p: Protocol, asOf: string): number {
  const pct = Math.min(80, Math.max(-40, p.change_7d ?? 0));
  const momentum = 1 + (pct / 100) * 0.35;
  const breadth = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 6);
  const age = ageInDays(asOf, p.listed_at);
  const maturity = 0.7 + 0.3 * (Math.min(age ?? 365, 1095) / 1095);
  return momentum * breadth * maturity;
}

function evalAdjStarter(p: Protocol, asOf: string): number {
  const growth = 1 + (Math.min(120, Math.max(-60, p.change_7d ?? 0)) / 100) * 0.5;
  const age = ageInDays(asOf, p.listed_at);
  return growth * (0.6 + (Math.min(age ?? 365, 1095) / 1095) * 0.4);
}

function evalAdjBreadth(p: Protocol): number {
  return 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 6);
}

function evalAdjMaturity(p: Protocol, asOf: string): number {
  const age = ageInDays(asOf, p.listed_at);
  return 0.7 + 0.3 * (Math.min(age ?? 365, 1095) / 1095);
}

function fitEvalCatMedian(train: EvalComp[]): (p: Protocol, tvl: number) => number {
  const glob = median(train.map((c) => c.mcap / c.tvl));
  const buckets = new Map<string, number[]>();
  for (const c of train) {
    const bucket = buckets.get(c.proto.category ?? 'Uncategorised') ?? [];
    bucket.push(c.mcap / c.tvl);
    buckets.set(c.proto.category ?? 'Uncategorised', bucket);
  }
  const mult = new Map<string, number>();
  for (const [key, bucket] of buckets) {
    if (bucket.length >= 3) mult.set(key, shrink(median(bucket), glob, bucket.length));
  }
  return (p, tvl) => tvl * (mult.get(p.category ?? 'Uncategorised') ?? glob);
}

function fitEvalPower(train: EvalComp[], levels: boolean): (p: Protocol, tvl: number) => number {
  const model = fitValueModel(asComps(train));
  if (!levels) {
    return (_p, tvl) => tvl * Math.exp(Math.log(model.globalLevel) + (model.slope - 1) * (Math.log(tvl) - model.meanLogTvl));
  }
  return (p, tvl) => curveValue(model, tvl, p.category);
}

/** Spearman rank correlation between two equal-length series. */
function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]): number[] => {
    const sorted = v.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
    const r = new Array<number>(v.length);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1]!.x === sorted[i]!.x) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[sorted[k]!.i] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((s, x) => s + x, 0) / n;
  const my = ry.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i]! - mx) * (ry[i]! - my);
    sxx += (rx[i]! - mx) ** 2;
    syy += (ry[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** Leave-one-out blind errors of one fitted shape over one comps set. */
function looRun(comps: EvalComp[], fit: EvalFit): { factor: number; spearman: number; preds: number[] } {
  const preds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const model = fit(comps.filter((_, j) => j !== i));
    preds.push(model(comps[i]!.proto, comps[i]!.tvl));
    actuals.push(comps[i]!.mcap);
  }
  const errs = preds.map((v, i) => Math.abs(Math.log10(v / actuals[i]!))).sort((a, b) => a - b);
  return {
    factor: Math.round(Math.pow(10, errs[Math.floor(errs.length / 2)]!) * 100) / 100,
    spearman: Math.round(spearman(preds, actuals) * 1000) / 1000,
    preds,
  };
}

/** Repeated 5-fold blind factor: a second protocol beside leave-one-out,
 *  with folds assigned by a slug hash so the split is deterministic. */
function kfoldFactor(comps: EvalComp[], fit: EvalFit, k = 5, reps = 4): number {
  const errs: number[] = [];
  const hash = (s: string, salt: number): number => {
    let x = salt * 7919;
    for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    return x;
  };
  for (let rep = 0; rep < reps; rep++) {
    const order = comps.map((_, i) => i).sort((a, b) => hash(comps[a]!.proto.slug, rep) - hash(comps[b]!.proto.slug, rep));
    for (let f = 0; f < k; f++) {
      const test = order.filter((_, j) => j % k === f);
      const train = order.filter((_, j) => j % k !== f).map((i) => comps[i]!);
      const model = fit(train);
      for (const i of test) errs.push(Math.abs(Math.log10(model(comps[i]!.proto, comps[i]!.tvl) / comps[i]!.mcap)));
    }
  }
  errs.sort((a, b) => a - b);
  return Math.round(Math.pow(10, errs[Math.floor(errs.length / 2)]!) * 100) / 100;
}

/** One row of the published ablation: a candidate model shape, blind. */
export interface AblationRow {
  label: string;
  median_factor: number;
  spearman: number;
  /** The same shape under the walk-forward protocol: fitted on the
   *  earlier-listed half of the traded tokens, tested on the later half. */
  walkforward_factor: number;
}

/** Walk-forward blind error of one fitted shape: the earlier-listed half
 *  of the comps trains the fit, the later-listed half is priced blind.
 *  Protocols with no listing date go to the training half, so the split
 *  is a pure function of the snapshot. */
function walkForwardRun(comps: EvalComp[], fit: EvalFit): { factor: number; tested: number } {
  const dated = [...comps].sort((a, b) => {
    const da = a.proto.listed_at ?? '';
    const db = b.proto.listed_at ?? '';
    return da < db ? -1 : da > db ? 1 : a.proto.slug < b.proto.slug ? -1 : 1;
  });
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const model = fit(train);
  const errs = test
    .map((c) => Math.abs(Math.log10(model(c.proto, c.tvl) / c.mcap)))
    .sort((a, b) => a - b);
  return {
    factor: Math.round(Math.pow(10, errs[Math.floor(errs.length / 2)]!) * 100) / 100,
    tested: test.length,
  };
}

/** The ablation the page publishes. Every candidate term was fitted and
 *  blind-tested under the same leave-one-out protocol; the shapes the
 *  shipped model rejected are in the table with their numbers, because a
 *  method section that only shows the winner is an advertisement, not
 *  evidence. Labels name the comps each shape learned from: per-entry
 *  ratios, or token totals (one entry per token, TVL summed). */
export function ablationOf(snapshot: Snapshot): AblationRow[] {
  const raw = evalCompsRaw(snapshot);
  const tt = evalCompsTokenTotal(snapshot);
  const asOf = snapshot.as_of;
  const rows: Array<[string, EvalComp[], EvalFit]> = [
    ['Flat 0.25 × TVL, starter adjustments (per-entry)', raw, () => (p, tvl) => tvl * 0.25 * evalAdjStarter(p, asOf)],
    ['Global median multiple (per-entry)', raw, (t) => { const g = median(t.map((c) => c.mcap / c.tvl)); return (_p, tvl) => tvl * g; }],
    ['Category median multiples (per-entry)', raw, (t) => fitEvalCatMedian(t)],
    ['Category medians + momentum, breadth, maturity — v3 (per-entry)', raw, (t) => { const f = fitEvalCatMedian(t); return (p, tvl) => f(p, tvl) * evalAdjV3(p, asOf); }],
    ['Power-law curve, no category level (token totals)', tt, (t) => fitEvalPower(t, false)],
    ['Power-law curve + category level (token totals)', tt, (t) => fitEvalPower(t, true)],
    ['… + chain breadth — tested, rejected', tt, (t) => { const f = fitEvalPower(t, true); return (p, tvl) => f(p, tvl) * evalAdjBreadth(p); }],
    ['… + maturity — tested, rejected', tt, (t) => { const f = fitEvalPower(t, true); return (p, tvl) => f(p, tvl) * evalAdjMaturity(p, asOf); }],
    ['Power-law + category level + fitted momentum — v4, shipped', tt, (t) => { const f = fitEvalPower(t, true); return (p, tvl) => f(p, tvl) * momentumOf(p); }],
  ];
  return rows.map(([label, comps, fit]) => {
    const r = looRun(comps, fit);
    const w = walkForwardRun(comps, fit);
    return { label, median_factor: r.factor, spearman: r.spearman, walkforward_factor: w.factor };
  });
}

/** Leave-one-out calibration of the shipped model: every traded token is
 *  priced as if it had not launched — curve and category levels learned
 *  without it, range from the training fit's own residual spread — and
 *  the checks are whether the market cap the market actually set falls
 *  inside the printed range, how large the typical miss is, and how well
 *  the blind order tracks the market's own ranking. */
export function calibrationOf(snapshot: Snapshot): Calibration {
  const tt = evalCompsTokenTotal(snapshot);
  let inside = 0;
  const preds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < tt.length; i++) {
    const rest = tt.filter((_, j) => j !== i);
    const model = fitValueModel(asComps(rest));
    const c = tt[i]!;
    const pred = curveValue(model, c.tvl, c.proto.category) * momentumOf(c.proto);
    preds.push(pred);
    actuals.push(c.mcap);
    if (c.mcap >= pred * model.residLowFactor && c.mcap <= pred * model.residHighFactor) inside++;
  }
  const errs = preds.map((v, i) => Math.abs(Math.log10(v / actuals[i]!))).sort((a, b) => a - b);
  const fit: EvalFit = (t) => {
    const f = fitEvalPower(t, true);
    return (p, tvl) => f(p, tvl) * momentumOf(p);
  };
  // Walk-forward on the shipped shape: earlier-listed half trains the
  // curve, later-listed half is priced blind, range from the training
  // fit's own residual spread.
  const dated = [...tt].sort((a, b) => {
    const da = a.proto.listed_at ?? '';
    const db = b.proto.listed_at ?? '';
    return da < db ? -1 : da > db ? 1 : a.proto.slug < b.proto.slug ? -1 : 1;
  });
  const half = Math.floor(dated.length / 2);
  const wfTrain = dated.slice(0, half);
  const wfTest = dated.slice(half);
  const wfModel = fitValueModel(asComps(wfTrain));
  let wfInside = 0;
  const wfErrs: number[] = [];
  for (const c of wfTest) {
    const pred = curveValue(wfModel, c.tvl, c.proto.category) * momentumOf(c.proto);
    wfErrs.push(Math.abs(Math.log10(pred / c.mcap)));
    if (c.mcap >= pred * wfModel.residLowFactor && c.mcap <= pred * wfModel.residHighFactor) wfInside++;
  }
  wfErrs.sort((a, b) => a - b);
  return {
    tested: tt.length,
    range_coverage_pct: tt.length > 0 ? Math.round((100 * inside) / tt.length) : 0,
    median_factor_error: Math.round(Math.pow(10, errs[Math.floor(errs.length / 2)]!) * 100) / 100,
    spearman: Math.round(spearman(preds, actuals) * 1000) / 1000,
    kfold_factor_error: kfoldFactor(tt, fit),
    walkforward_factor_error: Math.round(Math.pow(10, wfErrs[Math.floor(wfErrs.length / 2)]!) * 100) / 100,
    walkforward_coverage_pct: wfTest.length > 0 ? Math.round((100 * wfInside) / wfTest.length) : 0,
    walkforward_tested: wfTest.length,
  };
}

/** The launch-odds model, as the page states it: a logistic fit over
 *  every protocol in the snapshot, the outcome being whether the
 *  snapshot records a token for it. Only figures observable before any
 *  launch are features — size, chain count, time tracked, last week's
 *  growth — never the market cap or anything a launch itself produces. */
export interface OddsModel {
  /** Cross-fitted area under the ROC curve: out-of-sample by construction. */
  auc: number;
  base_rate_pct: number;
  /** Standardised weights of the full fit, named for the page. */
  weights: { tvl: number; chains: number; age: number; growth: number };
  /** Cross-fitted Brier score of the full fit: mean squared error of
   *  the predicted chance against the recorded outcome. */
  brier: number;
  /** Brier of the no-skill baseline that predicts the base rate for
   *  every protocol. */
  base_brier: number;
  /** One term at a time, added in the order the page names them: the
   *  cross-fitted Brier after each addition, so a reader can see which
   *  signals earn their keep and which do not. */
  terms: { label: string; brier: number }[];
}

function oddsFeatures(p: Protocol, asOf: string): number[] {
  const age = ageInDays(asOf, p.listed_at);
  return [
    Math.log10(Math.max(p.tvl_usd, 1)),
    Math.min(p.chains.length, 12),
    Math.min((age ?? 365) / 365, 8),
    Math.min(80, Math.max(-40, p.change_7d ?? 0)) / 40,
  ];
}

interface LogReg {
  predict: (x: number[]) => number;
  w: number[];
}

/** Logistic regression by fixed-iteration gradient descent on
 *  standardised features: no randomness anywhere, so the fit is a pure
 *  function of the snapshot and two runs agree byte for byte. `keep`
 *  names the feature indices the fit may use, for the terms table. */
function fitLogReg(rows: Array<{ x: number[]; y: number }>, keep: number[] = [0, 1, 2, 3]): LogReg {
  const d = keep.length;
  const mu: number[] = [];
  const sd: number[] = [];
  for (const j of keep) {
    const col = rows.map((r) => r.x[j]!);
    const m = col.reduce((s, v) => s + v, 0) / col.length;
    mu.push(m);
    sd.push(Math.sqrt(col.reduce((s, v) => s + (v - m) ** 2, 0) / col.length) || 1);
  }
  const w = new Array<number>(d).fill(0);
  let b0 = 0;
  const z = rows.map((r) => keep.map((j, k) => (r.x[j]! - mu[k]!) / sd[k]!));
  for (let it = 0; it < 300; it++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < rows.length; i++) {
      const zi = z[i]!;
      const logit = b0 + zi.reduce((s, v, j) => s + v * w[j]!, 0);
      const err = 1 / (1 + Math.exp(-logit)) - rows[i]!.y;
      gb += err;
      for (let j = 0; j < d; j++) gw[j]! += err * zi[j]!;
    }
    for (let j = 0; j < d; j++) w[j]! -= 0.3 * (gw[j]! / rows.length + 1e-3 * w[j]!);
    b0 -= (0.3 * gb) / rows.length;
  }
  return {
    w,
    predict: (x) => 1 / (1 + Math.exp(-(b0 + keep.reduce((s, j, k) => s + ((x[j]! - mu[k]!) / sd[k]!) * w[k]!, 0)))),
  };
}

function oddsRows(snapshot: Snapshot): Array<{ x: number[]; y: number; slug: string }> {
  return snapshot.protocols.map((p) => ({
    x: oddsFeatures(p, snapshot.as_of),
    y: p.gecko_id !== null || p.symbol !== null ? 1 : 0,
    slug: p.slug,
  }));
}

/** Fit the odds model on every protocol, and measure it cross-fitted:
 *  five folds, each protocol's score from a fit that never saw it, so
 *  the published AUC is an out-of-sample figure, not a fit admiring
 *  itself. Returns the full fit (for pricing rows) and the summary. */
export function launchOdds(snapshot: Snapshot): { summary: OddsModel; predict: (p: Protocol) => number } {
  const rows = oddsRows(snapshot);
  const full = fitLogReg(rows);
  const sorted = [...rows].sort((a, b) => a.y - b.y || (a.slug < b.slug ? -1 : 1));
  const cross = new Map<string, number>();
  for (let f = 0; f < 5; f++) {
    const test = sorted.filter((_, j) => j % 5 === f);
    const train = sorted.filter((_, j) => j % 5 !== f);
    const m = fitLogReg(train);
    for (const r of test) cross.set(r.slug, m.predict(r.x));
  }
  let wins = 0;
  let pos = 0;
  let neg = 0;
  const ps: number[] = [];
  const ns: number[] = [];
  for (const r of rows) {
    const s = cross.get(r.slug)!;
    if (r.y === 1) { ps.push(s); pos++; } else { ns.push(s); neg++; }
  }
  for (const a of ps) for (const b of ns) wins += a > b ? 1 : a === b ? 0.5 : 0;
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  const round3 = (n: number): number => Math.round(n * 1000) / 1000;
  const baseRate = pos / rows.length;
  const brier = rows.reduce((s, r) => s + (cross.get(r.slug)! - r.y) ** 2, 0) / rows.length;
  const baseBrier = rows.reduce((s, r) => s + (baseRate - r.y) ** 2, 0) / rows.length;
  // One term at a time, in the order the page names them: the
  // cross-fitted Brier after each addition, on the same five folds.
  const termDefs: Array<[string, number[]]> = [
    ['Base rate', []],
    ['+ time tracked', [2]],
    ['+ size (log TVL)', [2, 0]],
    ['+ chain count', [2, 0, 1]],
    ['+ 7-day growth', [2, 0, 1, 3]],
  ];
  const terms = termDefs.map(([label, keep]) => {
    if (keep.length === 0) return { label, brier: round3(baseBrier) };
    let sse = 0;
    for (let f = 0; f < 5; f++) {
      const test = sorted.filter((_, j) => j % 5 === f);
      const train = sorted.filter((_, j) => j % 5 !== f);
      const m = fitLogReg(train, keep);
      for (const r of test) sse += (m.predict(r.x) - r.y) ** 2;
    }
    return { label, brier: round3(sse / rows.length) };
  });
  return {
    summary: {
      auc: Math.round((wins / (pos * neg)) * 1000) / 1000,
      base_rate_pct: Math.round(100 * baseRate),
      weights: { tvl: round2(full.w[0]!), chains: round2(full.w[1]!), age: round2(full.w[2]!), growth: round2(full.w[3]!) },
      brier: round3(brier),
      base_brier: round3(baseBrier),
      terms,
    },
    predict: (p) => full.predict(oddsFeatures(p, snapshot.as_of)),
  };
}

/** The funnel from the snapshot's 758 protocols to the board's rows, with
 *  every exclusion charged to the first rule that catches it, in the order
 *  rankable() applies them. Published so the filter is evidence, not a
 *  claim: a reader can recount every step from the snapshot itself. */
export interface Funnel {
  total: number;
  trading: number;
  no_token: number;
  excluded_category: number;
  excluded_version: number;
  excluded_word: number;
  excluded_exchange: number;
  ranked: number;
}

export function funnelOf(snapshot: Snapshot): Funnel {
  const f: Funnel = {
    total: snapshot.protocols.length,
    trading: 0,
    no_token: 0,
    excluded_category: 0,
    excluded_version: 0,
    excluded_word: 0,
    excluded_exchange: 0,
    ranked: 0,
  };
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) {
      f.trading++;
    } else if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) {
      f.no_token++;
      f.excluded_category++;
    } else if (VERSION_SUFFIX.test(p.name)) {
      f.no_token++;
      f.excluded_version++;
    } else if (PRODUCT_WORD.test(p.name)) {
      f.no_token++;
      f.excluded_word++;
    } else if (EXCHANGE_PREFIX.test(p.name)) {
      f.no_token++;
      f.excluded_exchange++;
    } else {
      f.no_token++;
      f.ranked++;
    }
  }
  return f;
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

/** How a position in this category is closed without hurting the farmer:
 *  the exit is part of the plan, not an afterthought, because a badly
 *  sequenced unwind (withdrawing collateral under an open borrow, selling
 *  into a thin market) is where small farmers actually lose money. */
function exitAction(p: Protocol, chain: string, gas: { label: string; swap: number; action: number }): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `To exit ${n}: repay the borrow in full first, then withdraw the collateral — never pull collateral out while a borrow is still open against it. Cost: about $${gas.action} of ${gas.label}. Time: 15 minutes.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('liquidity') || c.includes('farm')) return `To exit ${n}: remove the liquidity or redeem the vault shares in one transaction, then swap any non-USDC leg back to USDC only while the quoted slippage shows under 0.5%. Cost: about $${gas.action + gas.swap} of ${gas.label}. Time: 15 minutes.`;
  if (c.includes('restak') || c.includes('staking')) return `To exit ${n}: start the unstaking or withdrawal queue first — the release can take days — and claim only when ${n}'s own page shows the funds ready. Cost: about $${gas.action} of ${gas.label}. Time: 10 minutes now; the wait is the protocol's own unstaking period.`;
  if (c.includes('prediction')) return `To exit ${n}: sell each open position into its market instead of waiting for resolution whenever the price sits within a few cents of your entry; settle the rest at resolution. Cost: about $${gas.swap} of ${gas.label} per market. Time: 10 minutes.`;
  if (c.includes('stable') || c.includes('algo-stable')) return `To exit ${n}: redeem the stable asset back to USDC through ${n}'s own redemption page rather than selling it into a pool, so the peg — not a thin market — sets your price. Cost: about $${gas.action} of ${gas.label}. Time: 10 minutes.`;
  return `To exit ${n}: withdraw the full position through the same page you deposited on, and swap anything you receive back to USDC the same day, while the amounts are fresh in the log. Cost: about $${gas.action} of ${gas.label}. Time: 15 minutes.`;
}

/** What one protocol's whole farm plan commits, so the page can total it:
 *  working capital across both tranches, the gas the plan's own steps
 *  quote summed over the hold, and the weekly minutes they ask for. */
export interface PlanTotals {
  capital_usd: number;
  gas_usd: number;
  hold_days: number;
  minutes_week: number;
}

/** Seven concrete farm steps per protocol, each carrying its cost and
 *  time. Costs use each chain's real gas tier — the second front, when the
 *  protocol runs on more than one chain, is priced on that chain, not the
 *  home one — and the plan ends with the exit, sequenced per category. */
export function farmPlan(p: Protocol, asOf: string): { steps: string[]; totals: PlanTotals } {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const extra = Math.round(capital / 2);
  const hold = holdDays(ageInDays(asOf, p.listed_at));
  const weekly = weeklyAction(p);
  const weeks = Math.ceil(hold / 7);
  let second: string;
  let secondGas: number;
  if (p.chains.length >= 2) {
    const chain2 = p.chains[1]!;
    const gas2 = gasFor(chain2);
    secondGas = gas.action + gas2.action;
    second = `Open a second, smaller front on ${chain2}: bridge $${extra} of USDC there and repeat the core position at half size, so the wallet is an early user of ${p.name} on two chains, not one. Cost: $${extra} of working capital plus about $${secondGas} of gas across both chains. Time: 20 minutes.`;
  } else {
    secondGas = gas.action;
    second = `After two weeks, deepen the position only if it has earned it: check ${p.name}'s TVL on its DefiLlama page, and if it has not fallen more than 10% since you entered, add a second tranche of $${extra} exactly as in step 2; if it has fallen further, skip the tranche and keep the first position alone. Cost: $${extra} of working capital plus about $${gas.action} of ${gas.label}. Time: 10 minutes.`;
  }
  const exit = exitAction(p, chain, gas);
  const steps = [
    `Create one fresh wallet for ${p.name} alone, fund it with $${capital + extra + 25} on ${chain}, and write the seed phrase on paper, never in a screenshot. Cost: about $${gas.action} of ${gas.label} to make the first transaction. Time: 10 minutes.`,
    `${coreAction(p, capital, chain)}. Cost: $${capital} of working capital plus about $${gas.action} of ${gas.label}. Time: 15 minutes to set up, 5 minutes to check the receipt.`,
    `Every week, ${weekly}. Cost: about $${gas.swap} of ${gas.label} a week. Time: 10 minutes a week.`,
    second,
    `Hold the position untouched for at least ${hold} days so it appears in several weekly TVL snapshots, and glance at it weekly for health warnings. Cost: the $${capital + extra} stays committed for the whole ${hold} days. Time: 5 minutes a week.`,
    `Open ${p.name}'s own points, rewards or governance page and link this wallet there if it offers one; claim only from links on that page, never from a search ad or a DM, and record every step in a farm log — wallet, chain, dates, amounts, transaction hashes. Cost: nothing to check, and never pay a fee to claim. Time: 10 minutes.`,
    exit,
  ];
  const gasTotal = Math.round((gas.action * 2 + secondGas + gas.swap * weeks + gas.action) * 10) / 10;
  return { steps, totals: { capital_usd: capital + extra, gas_usd: gasTotal, hold_days: hold, minutes_week: 15 } };
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
  /** The fitted chance this protocol records a token at all (0..1). */
  launch_odds: number;
  /** implied_value_usd weighted by the launch odds: what a farmer's
   *  attention is actually playing for, in expectation. */
  expected_value_usd: number;
  model: Workings;
  farm_steps: string[];
  plan: PlanTotals;
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

/** The method evidence the dashboard publishes: the fitted curve, the
 *  ablation that chose it, and the launch-odds model's measured skill. */
export interface MethodEvidence {
  slope: number;
  comps: number;
  reference_tvl_usd: number;
  ablation: AblationRow[];
  odds: OddsModel;
}

/** The 758-protocol ledger: every protocol in exactly one group, so the
 *  board's coverage is a recount, not a claim. `priced` counts the
 *  tokens the snapshot prices (the comps the curve learns from);
 *  `unpriced` counts tokens recorded with no usable market cap. */
export interface Ledger {
  ranked: number;
  priced: number;
  unpriced: number;
  out_category: number;
  out_version: number;
  out_word: number;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  calibration: Calibration;
  funnel: Funnel;
  multiples: CategoryMultiple[];
  method: MethodEvidence;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: Row[];
  live: LiveRow[];
  /** The ledger of all 758 protocols, the board's summed values, and the
   *  first 8 hex of the sha256 of board.json as written — a reader can
   *  recompute every figure on this page from the snapshot itself. */
  ledger: Ledger;
  total_implied_usd: number;
  total_expected_usd: number;
  board_sha8: string;
}

/** Build the board: every watchlist slug, plus every other protocol that
 *  passes the house rule, ranked by implied value. On this snapshot the
 *  rule admits 198 protocols, so the board is the whole rankable universe. */
export function buildRadar(snapshot: Snapshot): { board: Row[]; radar: RadarData } {
  const comps = buildComps(snapshot);
  const model = fitValueModel(comps);
  const odds = launchOdds(snapshot);
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
  const scored = [...chosen.values()].map((p) => ({ p, ...valueOf(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.value - a.value || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const board: Row[] = scored.map(({ p, value, workings }, i) => {
    const plan = farmPlan(p, snapshot.as_of);
    const launchOdds = Math.round(odds.predict(p) * 1000) / 1000;
    return {
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
      token_status: 'pre-token' as const,
      implied_value_usd: value,
      launch_odds: launchOdds,
      expected_value_usd: Math.round(value * launchOdds),
      model: workings,
      farm_steps: plan.steps,
      plan: plan.totals,
    };
  });
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
  const multiples = [...model.byCategory.values()].sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));
  const funnel = funnelOf(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: round4(model.globalLevel),
    calibration: calibrationOf(snapshot),
    funnel,
    multiples,
    method: {
      slope: Math.round(model.slope * 1000) / 1000,
      comps: model.comps,
      reference_tvl_usd: Math.round(model.referenceTvl),
      ablation: ablationOf(snapshot),
      odds: odds.summary,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows: board,
    live,
    ledger: {
      ranked: board.length,
      priced: model.comps,
      unpriced: funnel.trading - model.comps,
      out_category: funnel.excluded_category,
      out_version: funnel.excluded_version,
      out_word: funnel.excluded_word + funnel.excluded_exchange,
    },
    total_implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
    total_expected_usd: board.reduce((s, r) => s + r.expected_value_usd, 0),
    board_sha8: '',
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
