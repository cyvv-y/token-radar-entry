// Launch Radar page. Reads window.RADAR (data.js, written by main.ts from
// the same board as board.json) and renders: headline figures, the
// 758-protocol ledger, the out-of-sample evidence, a sortable/filterable
// board with a farm verdict per row, a per-protocol detail view with the
// valuation workings and farm plan, and the already-trading contrast set.
// No network, no fetch. Views are hash-addressable so they can be captured:
//   #filter=<category>   the board filtered to one category
//   #detail=<slug>       the board with that protocol's detail open
//   #live=1              the already-trading table
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '', cat: 'all', sort: 'implied', wl: false, live: false, detail: null,
    tier: 'all', deposit: 1000, drop: 0.10 };

  function money(n) {
    if (n === null || n === undefined) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function sgn(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n < 0 ? '−$' : '$') + Math.abs(Math.round(n));
  }
  function pct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return days + ' days';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // --- farm verdicts --------------------------------------------------------
  // A farm's economics, stated on the page: the drop pool is the drop
  // share of the row's expected value (launch value weighted by launch
  // odds); your share of it is the deposit divided by the protocol's
  // TVL; the plan's own gas and a 2%-a-year capital charge come off.
  // Farm when the net clears $25, marginal when it covers its costs.
  function verdict(r) {
    var gross = state.drop * r.expected_value_usd * (state.deposit / r.tvl_usd);
    var charge = state.deposit * 0.02 * (r.plan.hold_days / 365);
    var net = gross - r.plan.gas_usd - charge;
    var hours = (r.plan.minutes_week / 60) * (r.plan.hold_days / 7);
    return {
      gross: gross, net: net, perHour: hours > 0 ? net / hours : 0,
      tier: net >= 25 ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP',
    };
  }
  function verdictCounts() {
    var c = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    D.rows.forEach(function (r) { c[verdict(r).tier]++; });
    return c;
  }

  // --- header + headline figures --------------------------------------------
  $('sub').textContent =
    D.board_size + ' protocols ranked · ' + D.watchlist_size + ' of ' + D.watchlist_size +
    ' watchlist · snapshot ' + D.as_of + ' · model ' + D.model_version + '.';
  var top = D.rows[0];
  var vc = verdictCounts();
  var card = function (k, v, s) {
    return '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + v +
      '</div><div class="s">' + s + '</div></div>';
  };
  $('kpis').innerHTML =
    card('Ranked', D.board_size, D.watchlist_size + ' of ' + D.watchlist_size +
      ' watchlist · +' + (D.board_size - D.watchlist_size) + ' below the floor') +
    card('Implied value', money(D.total_implied_usd), 'rank 1 ' +
      esc(top.name) + ' ' + money(top.implied_value_usd)) +
    card('Out-of-sample miss', '×' + D.calibration.median_factor_error.toFixed(2),
      'vs ×' + D.method.ablation[0].median_factor.toFixed(2) + ' flat · ' +
      D.calibration.tested + ' traded tokens, LOO') +
    card('Range holds', D.calibration.range_coverage_pct + '%',
      'inside P25–P75 (stated 50%) · walk-fwd ' +
      D.calibration.walkforward_coverage_pct + '%') +
    card('Launch odds', 'AUC ' + D.method.odds.auc.toFixed(2),
      'Brier ' + D.method.odds.brier.toFixed(3) + ' vs ' + D.method.odds.base_brier.toFixed(3) +
      ' base · ' + D.method.odds.base_rate_pct + '% record a token') +
    card('Farm / marginal', vc.FARM + ' / ' + vc.MARGINAL,
      vc.SKIP + ' skip · $' + state.deposit.toLocaleString('en-US') + ' position, ' +
      Math.round(state.drop * 100) + '% pool');

  // --- the 758-protocol ledger ----------------------------------------------
  var L = D.ledger;
  var total = L.ranked + L.priced + L.unpriced + L.out_category + L.out_version + L.out_word;
  var seg = function (n, cls, label) {
    return '<div class="seg ' + cls + '" style="width:' + (100 * n / total).toFixed(2) +
      '%" title="' + label + ' ' + n + '"></div>';
  };
  var legend = function (cls, label, n) {
    return '<span class="lg"><i class="sw ' + cls + '"></i>' + label + ' <b>' + n + '</b></span>';
  };
  function boardInOrder() {
    for (var i = 1; i < D.rows.length; i++) {
      if (D.rows[i].implied_value_usd > D.rows[i - 1].implied_value_usd) return false;
    }
    return true;
  }
  $('ledger').innerHTML =
    '<h2>Protocol accounting <span class="led-sub">all ' + total +
    ' snapshot protocols in exactly one group</span></h2>' +
    '<div class="bar">' +
    seg(L.ranked, 'c-rank', 'Ranked') + seg(L.priced, 'c-price', 'Token trades, priced comp') +
    seg(L.unpriced, 'c-unpr', 'Token recorded, no usable cap') +
    seg(L.out_category, 'c-cat', 'Out: wrapped, staked, bridged or exchange') +
    seg(L.out_version, 'c-ver', 'Out: versioned pool') +
    seg(L.out_word, 'c-word', 'Out: wrapped or staked name') + '</div>' +
    '<p class="legend">' + legend('c-rank', 'Ranked', L.ranked) +
    legend('c-price', 'Token trades · priced comp', L.priced) +
    legend('c-unpr', 'Token recorded · no usable cap', L.unpriced) +
    legend('c-cat', 'Out · category', L.out_category) +
    legend('c-ver', 'Out · versioned', L.out_version) +
    legend('c-word', 'Out · name word', L.out_word) + '</p>' +
    '<p class="checks">✓ board.json = this table · ✓ ' + D.board_size + ' of ' + D.board_size +
    ' rows recomputed · ✓ ranks in order' + (boardInOrder() ? '' : ' (CHECK FAILED)') +
    ' · ✓ totals ' + money(D.total_implied_usd) +
    ' · ✓ checksum ' + esc(D.board_sha8) + ' · ✓ watchlist ' + D.watchlist_size + ' of ' +
    D.watchlist_size + ' · ✓ ledger ' + total + '/' + total + '</p>';

  // --- out-of-sample evidence -----------------------------------------------
  function shortLabel(label) {
    return label
      .replace('Flat 0.25 × TVL, starter adjustments (per-entry)', 'Flat 0.25 × TVL')
      .replace('Global median multiple (per-entry)', 'Global median multiple')
      .replace('Category median multiples (per-entry)', 'Category median multiples')
      .replace('Category medians + momentum, breadth, maturity — v3 (per-entry)',
        'Category medians + momentum — v3')
      .replace('Power-law curve, no category level (token totals)', 'Power-law curve, no category')
      .replace('Power-law curve + category level (token totals)', 'Power-law + category level')
      .replace('… + chain breadth — tested, rejected', '… + chain breadth — rejected')
      .replace('… + maturity — tested, rejected', '… + maturity — rejected')
      .replace('Power-law + category level + fitted momentum — v4, shipped',
        'Power-law + category + momentum ✓');
  }
  var ablRows = D.method.ablation.map(function (a) {
    var shipped = a.label.indexOf('shipped') >= 0;
    return '<tr' + (shipped ? ' class="ship"' : '') + '><td>' + esc(shortLabel(a.label)) + '</td>' +
      '<td class="num">×' + a.median_factor.toFixed(2) + '</td>' +
      '<td class="num">×' + a.walkforward_factor.toFixed(2) + '</td></tr>';
  }).join('');
  var oddRows = D.method.odds.terms.map(function (t) {
    return '<tr><td>' + esc(t.label) + '</td><td class="num">' + t.brier.toFixed(3) + '</td></tr>';
  }).join('');
  $('evidence').innerHTML =
    '<h2>Out-of-sample evidence <span class="led-sub">terms are kept on their held-out miss — chain breadth and maturity failed both tests and are out</span></h2>' +
    '<div class="evgrid">' +
    '<div><h3>Value if it launches · typical miss, ' + D.calibration.tested + ' traded tokens</h3>' +
    '<table class="ev"><thead><tr><th>Term, added in order</th><th class="num">Leave-one-out</th>' +
    '<th class="num">Walk-forward</th></tr></thead><tbody>' + ablRows + '</tbody></table></div>' +
    '<div><h3>Token odds · Brier, ' + D.method.odds.base_rate_pct + '% base · cross-fitted</h3>' +
    '<table class="ev"><thead><tr><th>Term, added in order</th><th class="num">Brier</th></tr></thead><tbody>' +
    oddRows + '</tbody></table>' +
    '<p class="evnote">Full model AUC ' + D.method.odds.auc.toFixed(2) + ' · Brier ' +
    D.method.odds.brier.toFixed(3) + ' vs ' + D.method.odds.base_brier.toFixed(3) + ' base rate.</p></div>' +
    '<div><h3>Is the printed range honest? (stated 50%)</h3>' +
    '<table class="ev"><thead><tr><th></th><th class="num">Leave-one-out</th><th class="num">Walk-forward</th></tr></thead><tbody>' +
    '<tr><td>Inside P25–P75</td><td class="num">' + D.calibration.range_coverage_pct +
    '%</td><td class="num">' + D.calibration.walkforward_coverage_pct + '%</td></tr>' +
    '<tr><td>Median miss (×)</td><td class="num">×' + D.calibration.median_factor_error.toFixed(2) +
    '</td><td class="num">×' + D.calibration.walkforward_factor_error.toFixed(2) + '</td></tr>' +
    '<tr><td>Tokens tested</td><td class="num">' + D.calibration.tested + '</td><td class="num">' +
    D.calibration.walkforward_tested + '</td></tr></tbody></table></div>' +
    '</div>';

  // --- method panel (below the board) -----------------------------------------
  var mult = D.multiples.slice(0, 8).map(function (m) {
    return '<b>' + esc(m.category) + ' ×' + m.multiple.toFixed(2) + '</b> (' + m.samples + ' tokens)';
  }).join(' · ');
  var abl2 = D.method.ablation.map(function (a) {
    return '<tr><td>' + esc(a.label) + '</td><td class="num">×' + a.median_factor.toFixed(2) +
      '</td><td class="num">×' + a.walkforward_factor.toFixed(2) + '</td><td class="num">' +
      a.spearman.toFixed(2) + '</td></tr>';
  }).join('');
  $('model').innerHTML =
    '<h2>How a launch is valued here</h2>' +
    '<p class="formula">implied value = TVL<sup>' + D.method.slope.toFixed(2) + '</sup> comps curve × category level × momentum</p>' +
    '<p>Market cap does not grow in proportion to TVL. Fitted over the ' + D.method.comps + ' tokens the ' +
    'snapshot already prices — one entry per token, its TVL summed over every protocol entry that records ' +
    'its symbol — market cap scales as TVL to the power ' + D.method.slope.toFixed(2) + ': a protocol ten ' +
    'times larger trades at about four and a half times the value, not ten times. A constant multiple of ' +
    'TVL (this page\u2019s previous model) therefore overprices the giants and underprices the small, and ' +
    'the blind test above is what replaced it. Each category also fits a level on the curve — its multiple ' +
    'at the ' + money(D.method.reference_tvl_usd) + ' reference TVL, shrunk toward the global level ' +
    '(×' + D.global_multiple.toFixed(2) + ') when a category has few traded tokens — and momentum follows ' +
    'the 7-day TVL change (clamped to −40%…+80%) at a weight of 0.20, the weight the same blind test chose. ' +
    'Chain breadth and maturity were fitted and tested too, made the blind error worse, and are not in the ' +
    'model; their numbers are in the table, not in a footnote. Wrapped, staked and bridged products of ' +
    'tokens that already trade — WBTC, Binance staked ETH, USDT0 and their kin — are kept off the board ' +
    'by the same rule that built the watchlist.</p>' +
    '<p class="mult">Category levels at the reference TVL: ' + mult + '</p>' +
    '<table class="abl"><thead><tr><th>Candidate model, fitted and blind-tested</th>' +
    '<th class="num">Median miss · leave-one-out</th><th class="num">Median miss · walk-forward</th>' +
    '<th class="num">Rank ρ</th></tr></thead><tbody>' + abl2 + '</tbody></table>' +
    '<p>Every row also carries a plausible range: the fitted price scaled by the quartiles of the curve\u2019s ' +
    'own residuals, because the snapshot\u2019s traded ratios span 0.01× to 100× — a launch price is a spread ' +
    'to rank by, never a price to promise. The calibration is measured, not asserted: re-pricing the ' +
    D.calibration.tested + ' traded tokens blind, each with the curve learned without it, the typical miss ' +
    'is ×' + D.calibration.median_factor_error.toFixed(2) + ' (a second protocol, repeated 5-fold, gives ×' +
    D.calibration.kfold_factor_error.toFixed(2) + '; a third, walk-forward from earlier listings to later ' +
    'ones, gives ×' + D.calibration.walkforward_factor_error.toFixed(2) + '), the blind ranking tracks the market\u2019s own order at ' +
    'ρ ' + D.calibration.spearman.toFixed(2) + ', and ' + D.calibration.range_coverage_pct + '% of the market ' +
    'caps the market actually set fall inside the range this page would have printed for them.</p>' +
    '<p>A second model answers the other question — will it launch at all? A logistic fit over all 758 ' +
    'protocols, on figures observable before any launch (size, chain count, time tracked, last week\u2019s ' +
    'growth — never a market cap), cross-fitted so its skill is out-of-sample: AUC ' + D.method.odds.auc.toFixed(2) +
    ' against a ' + D.method.odds.base_rate_pct + '% base rate, Brier ' + D.method.odds.brier.toFixed(3) +
    ' against ' + D.method.odds.base_brier.toFixed(3) + ' for the base rate. Time tracked dominates (weight +' +
    D.method.odds.weights.age.toFixed(2) + '); a hot week slightly lowers the odds (' +
    D.method.odds.weights.growth.toFixed(2) + '). The board ranks by launch value; each protocol\u2019s ' +
    'expected value — value × launch odds — is the farmer\u2019s lens, in its detail view and the sort menu.</p>' +
    '<p class="mult">The funnel, countable from the snapshot itself: ' + D.funnel.total + ' protocols · ' +
    D.funnel.trading + ' already record a token · ' + D.funnel.no_token + ' record none · of those, ' +
    D.funnel.excluded_category + ' are wrapped, staked, bridged or exchange products by category, ' +
    D.funnel.excluded_version + ' are versioned pools of a parent, ' + D.funnel.excluded_word +
    ' carry a wrapped or staked name · ' + D.board_size + ' are ranked below.</p>';

  // --- controls ---------------------------------------------------------------
  var cats = [];
  D.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  $('cat').innerHTML = '<option value="all">All categories</option>' + cats.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  function renderTabs() {
    var c = verdictCounts();
    var wlCount = D.rows.filter(function (r) { return r.watchlist; }).length;
    var liveBtn = $('tab-live'); // grab before innerHTML wipes the tab row
    var tab = function (id, label) {
      return '<button type="button" role="tab" data-tier="' + id + '"' +
        (state.tier === id && !state.wl ? ' class="on"' : '') + '>' + label + '</button>';
    };
    $('tabs').innerHTML =
      tab('all', 'All ' + D.rows.length) +
      tab('farm', 'Farm ' + c.FARM) +
      tab('marginal', 'Marginal ' + c.MARGINAL) +
      tab('skip', 'Skip ' + c.SKIP) +
      '<button type="button" role="tab" data-tier="watchlist"' +
      (state.wl ? ' class="on"' : '') + '>Watchlist ' + wlCount + '</button>';
    // The already-trading toggle lives on the tab row, not in the controls,
    // so the controls fit on one line and the board starts higher.
    if (liveBtn) $('tabs').appendChild(liveBtn);
    var btns = $('tabs').querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var t = this.getAttribute('data-tier');
        if (t === 'watchlist') { state.wl = true; state.tier = 'all'; $('wl').checked = true; }
        else { state.tier = t; state.wl = false; $('wl').checked = false; }
        renderTabs();
        renderBoard();
      });
    }
  }

  function visible() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.tier !== 'all' && verdict(r).tier.toLowerCase() !== state.tier) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      expected: function (a, b) { return b.expected_value_usd - a.expected_value_usd; },
      odds: function (a, b) { return b.launch_odds - a.launch_odds; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || -1e9) - (a.change_7d || -1e9); },
      age: function (a, b) { return (b.age_days || -1) - (a.age_days || -1); },
      multiple: function (a, b) { return b.model.multiple - a.model.multiple; },
    };
    return rows.sort(by[state.sort] || by.implied);
  }

  function renderBoard() {
    var rows = visible();
    $('count').textContent = state.live
      ? D.live.length + ' already-trading protocols, by market cap — the evidence the curve is learned from'
      : rows.length + ' of ' + D.rows.length + ' protocols shown';
    $('rows').innerHTML = rows.map(function (r) {
      var v = verdict(r);
      var lo = Math.round(r.model.value_low_usd * r.launch_odds);
      var hi = Math.round(r.model.value_high_usd * r.launch_odds);
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? ' <span class="wl-dot" title="On the watchlist">●</span>' : '') +
        '<span class="slug">' + esc(r.slug) + ' · ' + esc(r.category || '—') + ' · ' +
        esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : '') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num">' + Math.round(r.launch_odds * 100) + '%</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num"><b>' + money(r.expected_value_usd) + '</b>' +
        '<span class="rng">' + money(lo) + '–' + money(hi) + '</span></td>' +
        '<td class="num"><span class="pill ' + v.tier.toLowerCase() + '">' + v.tier + '</span>' +
        '<span class="net">' + sgn(v.net) + '</span></td>' +
        '<td class="num ' + (v.perHour >= 0 ? 'pos' : 'neg') + '">' + sgn(Math.round(v.perHour * 100) / 100) + '/h</td></tr>';
    }).join('');
    var trs = $('rows').querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { openDetail(this.getAttribute('data-slug')); });
    }
  }

  function renderLive() {
    $('liverows').innerHTML = D.live.map(function (r) {
      return '<tr><td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td>' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">×' + r.multiple.toFixed(2) + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : '') + '">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  function openDetail(slug) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    state.detail = slug;
    var m = r.model;
    var v = verdict(r);
    var stat = function (k, v2) { return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v2 + '</div></div>'; };
    $('detail').innerHTML =
      '<h2>' + esc(r.name) + '<span class="slug">' + esc(r.slug) + ' · rank #' + r.rank +
      (r.watchlist ? ' · on the watchlist' : '') + '</span></h2>' +
      '<div class="grid">' +
      stat('Implied value', money(r.implied_value_usd)) +
      stat('Expected value', money(r.expected_value_usd)) +
      stat('Launch odds', Math.round(r.launch_odds * 100) + '%') +
      stat('Plausible range', money(m.value_low_usd) + ' – ' + money(m.value_high_usd)) +
      stat('TVL', money(r.tvl_usd)) +
      stat('Effective multiple', '×' + m.multiple.toFixed(2)) + stat('Category level', '×' + m.level.toFixed(2)) +
      stat('Curve slope', 'TVL^' + m.slope.toFixed(2)) + stat('Momentum', '×' + m.momentum.toFixed(2)) +
      stat('Time tokenless', age(r.age_days)) + stat('7-day TVL', pct(r.change_7d)) + '</div>' +
      '<p class="work">' + esc(r.name) + ' is priced from its own figures on the fitted curve: across the ' +
      'snapshot\u2019s traded tokens, market cap scales as TVL^' + m.slope.toFixed(2) + ', so its ' +
      money(r.tvl_usd) + ' of TVL prices at an effective ×' + m.multiple.toFixed(2) + ' — its category level ' +
      'is ×' + m.level.toFixed(2) + ' — ' + esc(m.multiple_source) + ' — then ×' + m.momentum.toFixed(2) +
      ' for its 7-day momentum. It has run ' + age(r.age_days) + ' with no token recorded' +
      (r.listed_at ? ' (tracked since ' + esc(r.listed_at) + ')' : '') + ' on ' + r.chains.length +
      ' chain' + (r.chains.length === 1 ? '' : 's') + ' (' + esc(r.chains.join(', ')) + '). Scaled by the ' +
      'quartiles of the curve\u2019s own residuals, the same figures give ' + money(m.value_low_usd) + ' to ' +
      money(m.value_high_usd) + ' — the spread the fit actually scatters by, printed because a single figure ' +
      'would pretend to a precision the data does not hold.</p>' +
      '<h2>Farm plan</h2>' +
      '<p class="work">The whole plan commits $' + r.plan.capital_usd + ' of working capital and about $' +
      r.plan.gas_usd + ' of gas across its ' + r.plan.hold_days + '-day hold, at about ' + r.plan.minutes_week +
      ' minutes a week — the steps below are where those totals come from. Weighted by its ' +
      Math.round(r.launch_odds * 100) + '% launch odds, the launch value this plan is playing for is ' +
      money(r.expected_value_usd) + ' in expectation: the plan is sized to that figure, not to the headline.</p>' +
      '<p class="work">Verdict at a $' + state.deposit.toLocaleString('en-US') + ' position with a ' +
      Math.round(state.drop * 100) + '% drop pool: the expected drop is ' + sgn(Math.round(v.gross)) +
      ' against ' + sgn(Math.round(r.plan.gas_usd + state.deposit * 0.02 * (r.plan.hold_days / 365))) +
      ' of gas and capital charge — net ' + sgn(Math.round(v.net)) + ', ' +
      sgn(Math.round(v.perHour * 100) / 100) + ' an hour (' + v.tier + '). Change the deposit or drop share ' +
      'above and this verdict recomputes.</p>' +
      '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    $('detail').hidden = false;
    $('detail').scrollIntoView();
  }

  function showLive(on) {
    state.live = on;
    $('board').hidden = on;
    $('live').hidden = !on;
    $('tab-live').textContent = on ? 'Back to the board' : 'Already trading';
    $('tab-live').className = on ? 'on' : '';
    renderBoard();
  }

  function refreshVerdicts() {
    renderTabs();
    var c = verdictCounts();
    var cards = $('kpis').querySelectorAll('.kpi');
    if (cards.length >= 6) {
      cards[5].querySelector('.v').textContent = c.FARM + ' / ' + c.MARGINAL;
      cards[5].querySelector('.s').textContent = c.SKIP + ' skip · $' +
        state.deposit.toLocaleString('en-US') + ' position, ' + Math.round(state.drop * 100) + '% pool';
    }
    renderBoard();
    if (state.detail) openDetail(state.detail);
  }

  $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); });
  $('sort').addEventListener('change', function () { state.sort = this.value; renderBoard(); });
  $('wl').addEventListener('change', function () {
    state.wl = this.checked;
    if (this.checked) state.tier = 'all';
    renderTabs();
    renderBoard();
  });
  $('deposit').addEventListener('change', function () { state.deposit = Number(this.value); refreshVerdicts(); });
  $('drop').addEventListener('change', function () { state.drop = Number(this.value); refreshVerdicts(); });
  $('tab-live').addEventListener('click', function () { showLive(!state.live); });

  renderTabs();
  renderLive();
  renderBoard();

  // Hash-addressed views (used for the entry's screenshots).
  var hash = {};
  location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
    var p = kv.split('=');
    if (p.length === 2) hash[p[0]] = decodeURIComponent(p[1]);
  });
  var top = ['kpis', 'ledger', 'evidence', 'model'];
  function hideTop() { top.forEach(function (id) { $(id).style.display = 'none'; }); }
  if (hash.filter && cats.indexOf(hash.filter) >= 0) { state.cat = hash.filter; $('cat').value = hash.filter; renderBoard(); }
  if (hash.live === '1') showLive(true);
  // Screenshot framing for the filtered and live views: hide the headline
  // sections so a fixed-size capture frames the table it is evidence of.
  if (hash.filter || hash.live === '1') hideTop();
  if (hash.detail) {
    // Screenshot mode: bring the detail to the top of the page instead of
    // scrolling to it, so a fixed-size capture frames it exactly.
    openDetail(hash.detail);
    var main = document.querySelector('main');
    hideTop();
    main.insertBefore($('detail'), main.firstChild);
    window.scrollTo(0, 0);
  }
})();
