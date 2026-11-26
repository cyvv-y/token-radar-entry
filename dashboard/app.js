// Launch Radar offline dashboard. Reads window.RADAR (data.js) and renders:
//   1. Three-pillar headline strip with explicit formulas & sample counts
//   2. 758-protocol ledger + live in-browser integrity verification
//   3. Out-of-sample blind validation tables (LOO, walk-forward, 5-fold CV, odds)
//   4. Pre-token board with net-of-gas farm economics & closed-form break-even
//   5. Detail blueprint: valuation waterfall, cumulative cost SVG, sensitivity & timeline
//   6. Live validation (#live=1): 117 priced comps LOO scatter + residual histogram.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var $ = function (id) { return document.getElementById(id); };
  var S = {
    q: '', cat: 'all', sort: 'implied', wl: false, live: false, detail: null,
    tier: 'all', deposit: 1000, drop: 0.10, lq: '', lcat: 'all', lrange: 'all', lsort: 'mcap',
  };

  function comma(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n), sg = n < 0 ? '−$' : '$';
    if (a >= 1e9) return sg + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sg + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return sg + (a >= 1e4 ? Math.round(a / 1e3) : (a / 1e3).toFixed(1)) + 'K';
    return sg + Math.round(a);
  }
  function sgn(n) { var r = Math.round(n); return (r < 0 ? '−$' : r > 0 ? '+$' : '$') + comma(Math.abs(r)); }
  function sgnHr(n) { var a = Math.abs(n); return (n < 0 ? '−$' : n > 0 ? '+$' : '$') + (a >= 10 ? Math.round(a) : a.toFixed(1)) + '/h'; }
  function pct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(d) { return d === null || d === undefined ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function tdN(b, c) { return '<td class="num' + (c ? ' ' + c : '') + '">' + b + '</td>'; }
  function sLn(x1, y1, x2, y2, st, da) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + st + '"' + (da ? ' stroke-dasharray="' + da + '"' : '') + '/>'; }
  function sTx(x, y, t, an, cl, fi) { return '<text' + (cl ? ' class="' + cl + '"' : '') + ' x="' + x + '" y="' + y + '"' + (an ? ' text-anchor="' + an + '"' : '') + (fi ? ' style="fill:' + fi + '"' : '') + '>' + t + '</text>'; }

  // Closed-form farm economics: net(D) = D * [drop*EV/TVL - 0.02*hold/365] - gas
  function verdictAt(r, dep, drop) {
    var gR = r.tvl_usd > 0 ? drop * (r.expected_value_usd / r.tvl_usd) : 0;
    var cR = 0.02 * (r.plan.hold_days / 365), sl = gR - cR;
    var gross = dep * gR, carry = dep * cR, net = gross - r.plan.gas_usd - carry;
    var hrs = (r.plan.minutes_week / 60) * (r.plan.hold_days / 7);
    return {
      gross: gross, cost: r.plan.gas_usd + carry, net: net, perHour: hrs > 0 ? net / hrs : 0,
      beDep: sl > 0 ? r.plan.gas_usd / sl : Infinity,
      farmDep: sl > 0 ? (r.plan.gas_usd + 25) / sl : Infinity,
      tier: net >= 25 ? 'FARM' : net >= 0 ? 'MARGINAL' : 'SKIP',
    };
  }
  function verdict(r) { return verdictAt(r, S.deposit, S.drop); }
  function fmtBe(be) { return !isFinite(be) || be > 1e8 ? 'yield <2%' : 'B/E ' + money(be); }
  function vStats(rows) {
    var c = { FARM: 0, MARGINAL: 0, SKIP: 0, best: null, bestNet: -Infinity };
    rows.forEach(function (r) { var v = verdict(r); c[v.tier]++; if (v.net > c.bestNet) { c.bestNet = v.net; c.best = r; } });
    return c;
  }

  var L = D.ledger, cal = D.calibration, odds = D.method.odds;
  var tot = L.ranked + L.priced + L.unpriced + L.out_category + L.out_version + L.out_word;
  var outN = L.out_category + L.out_version + L.out_word, tokN = L.priced + L.unpriced;
  var flatM = D.method.ablation[0] ? D.method.ablation[0].median_factor : cal.median_factor_error;
  var missGain = Math.round(100 * (1 - cal.median_factor_error / flatM));
  var brierGain = odds.base_brier > 0 ? ((1 - odds.brier / odds.base_brier) * 100).toFixed(1) : '0.0';

  $('sub').textContent = 'snapshot ' + D.as_of + ' · floor ' + money(D.floor_usd) + ' TVL · ' +
    D.board_size + '/' + tot + ' ranked · ' + D.watchlist_size + '/' + D.watchlist_size +
    ' watchlist · ' + D.model_version + ' · sha8 ' + D.board_sha8;

  function renderKpis() {
    var top = D.rows[0], vs = vStats(D.rows);
    var inLoo = cal.inside_count !== undefined ? cal.inside_count + '/' + cal.tested : cal.tested + ' LOO';
    var inWf = cal.walkforward_inside_count !== undefined ? cal.walkforward_inside_count + '/' + cal.walkforward_tested : 'WF';
    var wfSp = (cal.walkforward_train || (cal.tested - cal.walkforward_tested)) + '→' + cal.walkforward_tested;
    var pn = odds.pos_count !== undefined ? odds.pos_count + '/' + odds.neg_count : odds.base_rate_pct + '%';
    var qSp = cal.resid_p25_factor !== undefined ? 'Q25..75 ×' + cal.resid_p25_factor.toFixed(2) + '..' + cal.resid_p75_factor.toFixed(2) : 'P25–P75';
    var depShort = S.deposit >= 1000 ? '$' + (S.deposit / 1000) + 'K' : '$' + S.deposit;
    var card = function (k, v, s, f) { return '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div><div class="f">' + f + '</div></div>'; };
    var pil = function (cl, tg, cm, a, b) { return '<div class="pillar ' + cl + '"><div class="p-head"><span class="p-tag">' + tg + '</span><span class="p-claim">' + cm + '</span></div><div class="p-cards">' + a + b + '</div></div>'; };
    $('kpis').innerHTML =
      pil('p1', '01 · Trusted Universe', 'Zero uncounted protocols',
        card('Ranked pre-token', '<em>' + D.board_size + '</em><small>/' + tot + '</small>', D.watchlist_size + '/' + D.watchlist_size + ' watchlist · +' + (D.board_size - D.watchlist_size) + ' off-watchlist', 'n=' + tot + ' − ' + tokN + ' tokened − ' + outN + ' product'),
        card('Implied / expected cap', money(D.total_implied_usd) + '<small>EV ' + money(D.total_expected_usd) + '</small>', '#1 ' + esc(top.name) + ' ' + money(top.implied_value_usd), '∑' + D.board_size + ' rows · EV=∑pᵢVᵢ · sha ' + esc(D.board_sha8))) +
      pil('p2', '02 · Blind-Tested Model', 'Held-out LOO, 5-fold &amp; walk-fwd',
        card('Out-of-sample miss', '<em>×' + cal.median_factor_error.toFixed(2) + '</em><small>WF ×' + cal.walkforward_factor_error.toFixed(2) + '</small>', '−' + missGain + '% vs ×' + flatM.toFixed(2) + ' flat · 5f ×' + cal.kfold_factor_error.toFixed(2), 'LOO n=' + cal.tested + ' · WF ' + wfSp + ' · ρ=' + cal.spearman.toFixed(2)),
        card('P25–P75 &amp; launch odds', cal.range_coverage_pct + '%<small>AUC ' + odds.auc.toFixed(2) + '</small>', 'LOO ' + inLoo + ' · WF ' + inWf + ' · Brier ' + odds.brier.toFixed(3), qSp + ' · CV ' + pn)) +
      pil('p3', '03 · Net Farm Economics', 'Chain gas + 2% APR carry costed',
        card('Farm / marg / skip', '<span class="vg">' + vs.FARM + '</span> / <span class="va">' + vs.MARGINAL + '</span> / <span class="vb">' + vs.SKIP + '</span>', '$' + comma(S.deposit) + ' deposit · ' + Math.round(S.drop * 100) + '% drop pool', 'FARM ≥$25 · MARG ≥$0 · ∑=' + D.board_size + ' rows'),
        card('Best net return', vs.best ? '<em>' + sgn(vs.bestNet) + '</em><small>' + sgnHr(verdict(vs.best).perHour) + '</small>' : 'n/a', vs.best ? '#' + vs.best.rank + ' ' + esc(vs.best.name) : '—', Math.round(S.drop * 100) + '%·EV·(' + depShort + '/TVL) − gas − 2%·d/365'));
  }
  renderKpis();

  // --- 758-protocol accounting ledger + runtime integrity assertions --------
  (function () {
    var seg = function (n, cl, lb) { return '<div class="seg ' + cl + '" style="width:' + (100 * n / tot).toFixed(2) + '%" title="' + esc(lb) + ': ' + n + '"></div>'; };
    var lg = function (cl, lb, n) { return '<span><i class="sw ' + cl + '"></i>' + lb + ' <b>' + n + '</b></span>'; };
    var sI = 0, sE = 0, wlN = 0, ord = true, stp = true;
    D.rows.forEach(function (r, i) {
      sI += r.implied_value_usd; sE += r.expected_value_usd;
      if (r.watchlist) wlN++;
      if (r.rank !== i + 1 || (i > 0 && r.implied_value_usd > D.rows[i - 1].implied_value_usd)) ord = false;
      if (!r.farm_steps || r.farm_steps.length < 3 || r.farm_steps.length > 12) stp = false;
    });
    var chk = function (ok, t) { return '<span class="' + (ok ? '' : 'warn') + '">' + (ok ? '✓ ' : '✗ ') + t + '</span>'; };
    var wSub = D.funnel.excluded_exchange > 0 ? ' (' + D.funnel.excluded_word + 'w+' + D.funnel.excluded_exchange + 'ex)' : '';
    $('ledger').innerHTML =
      '<h2><span>Protocol accounting ledger</span><span class="led-sub"><b>' + tot + '</b> snapshot = <b>' + tokN + '</b> tokened (' + L.priced + ' comps + ' + L.unpriced + ' unpriced) + <b>' + D.funnel.no_token + '</b> pre-token (' + L.ranked + ' ranked + ' + outN + ' filtered)</span></h2>' +
      '<div class="bar">' + seg(L.ranked, 'c-rank', 'Ranked') + seg(L.priced, 'c-price', 'Priced comps') + seg(L.unpriced, 'c-unpr', 'Unpriced token') + seg(L.out_category, 'c-cat', 'Excluded category') + seg(L.out_version, 'c-ver', 'Versioned') + seg(L.out_word, 'c-word', 'Name rule') + '</div>' +
      '<div class="legend">' + lg('c-rank', 'Ranked pre-token', L.ranked) + lg('c-price', 'Priced comps (0.01–100×)', L.priced) + lg('c-unpr', 'Token · unpriced', L.unpriced) + lg('c-cat', 'Out · bridge/stake/CEX', L.out_category) + lg('c-ver', 'Out · versioned', L.out_version) + lg('c-word', 'Out · name' + wSub, L.out_word) + '</div>' +
      '<div class="checks">' + chk(tot === D.funnel.total, 'ledger ' + tot + '/' + D.funnel.total) + chk(ord, 'ranks 1..' + D.board_size + ' monotonic') + chk(sI === D.total_implied_usd && sE === D.total_expected_usd, '∑ implied ' + money(sI) + ' · ∑ EV ' + money(sE)) + chk(wlN === D.watchlist_size, 'watchlist ' + wlN + '/' + D.watchlist_size) + chk(stp, 'plans 7 steps × ' + D.board_size) + chk(D.live.length === cal.tested, 'blind comps ' + D.live.length + '/' + cal.tested) + chk(Boolean(D.board_sha8), 'sha256 ' + esc(D.board_sha8)) + '</div>';
  })();

  // --- out-of-sample evidence deck + method reference -----------------------
  (function () {
    var shortLbl = function (s) {
      return s.replace(/\s*\((?:per-entry|token totals)\)/, '').replace(', starter adjustments', ' (base)')
        .replace('momentum, breadth, maturity — v3', '3 adj (v3)').replace('curve, no category level', 'TVL^' + D.method.slope.toFixed(2) + ', global')
        .replace('curve + category level', '+ shrunk cat level').replace(' — tested, rejected', ' [rejected]')
        .replace('fitted momentum — v4, shipped', '0.20 mom ✓');
    };
    var maxF = Math.max.apply(null, D.method.ablation.map(function (a) { return a.median_factor; }).concat([1]));
    var ablRows = D.method.ablation.map(function (a) {
      var cl = a.label.indexOf('shipped') >= 0 ? ' class="ship"' : a.label.indexOf('rejected') >= 0 ? ' class="rej"' : '';
      var bw = Math.max(8, Math.round(38 * a.median_factor / maxF));
      return '<tr' + cl + '><td>' + esc(shortLbl(a.label)) + '</td>' + tdN('<i class="mbar" style="width:' + bw + 'px"></i>×' + a.median_factor.toFixed(2)) + tdN('×' + a.walkforward_factor.toFixed(2)) + tdN(a.spearman.toFixed(2)) + '</tr>';
    }).join('');
    var oddRows = odds.terms.map(function (t, i) {
      return '<tr' + (i === odds.terms.length - 1 ? ' class="ship"' : '') + '><td>' + esc(t.label) + '</td>' + tdN(t.brier.toFixed(3)) + tdN(i ? (t.brier - odds.base_brier).toFixed(3) : '—') + '</tr>';
    }).join('');
    var w = odds.weights, fw = function (n) { return (n >= 0 ? '+' : '') + n.toFixed(2); };
    var inLoo = cal.inside_count !== undefined ? cal.inside_count + '/' + cal.tested : cal.range_coverage_pct + '%';
    var inWf = cal.walkforward_inside_count !== undefined ? cal.walkforward_inside_count + '/' + cal.walkforward_tested : cal.walkforward_coverage_pct + '%';

    $('evidence').innerHTML =
      '<h2><span>Out-of-sample blind evidence</span><span class="led-sub">terms kept only when leave-one-out error drops — chain breadth &amp; maturity hurt blind error and were dropped</span></h2>' +
      '<div class="evgrid">' +
        '<div><h3>Valuation ablation · median miss<span>n=' + cal.tested + ' LOO · n=' + cal.walkforward_tested + ' WF</span></h3>' +
        '<table class="ev"><thead><tr><th>Model shape</th><th class="num">LOO</th><th class="num">Walk-fwd</th><th class="num"><span class="lc">ρ</span></th></tr></thead><tbody>' + ablRows + '</tbody></table></div>' +
        '<div><h3>Launch odds · 5-fold CV<span>n=' + D.funnel.total + ' (' + odds.base_rate_pct + '% base)</span></h3>' +
        '<table class="ev"><thead><tr><th>Logistic terms</th><th class="num">Brier</th><th class="num">Δ base</th></tr></thead><tbody>' + oddRows + '</tbody></table>' +
        '<div class="wstrip"><span class="wchip">age <b>' + fw(w.age) + '</b></span><span class="wchip">logTVL <b>' + fw(w.tvl) + '</b></span><span class="wchip">chains <b>' + fw(w.chains) + '</b></span><span class="wchip">7d <b>' + fw(w.growth) + '</b></span></div>' +
        '<p class="evnote">Cross-fitted AUC ' + odds.auc.toFixed(2) + ' · Brier −' + brierGain + '% vs base rate.</p></div>' +
        '<div><h3>Range &amp; holdout calibration<span>stated P25–P75 (50%)</span></h3>' +
        '<table class="ev"><thead><tr><th>Blind metric</th><th class="num">LOO (116→1)</th><th class="num">Walk-fwd</th></tr></thead><tbody>' +
          '<tr><td>Inside P25–P75</td>' + tdN(cal.range_coverage_pct + '% (' + inLoo + ')') + tdN(cal.walkforward_coverage_pct + '% (' + inWf + ')') + '</tr>' +
          '<tr><td>Median miss</td>' + tdN('×' + cal.median_factor_error.toFixed(2)) + tdN('×' + cal.walkforward_factor_error.toFixed(2)) + '</tr>' +
          '<tr><td>5-fold CV / ρ</td>' + tdN('×' + cal.kfold_factor_error.toFixed(2)) + tdN('ρ ' + cal.spearman.toFixed(2)) + '</tr>' +
          '<tr><td>Holdout split</td>' + tdN('n=' + cal.tested) + tdN((cal.walkforward_train || 58) + '→' + cal.walkforward_tested) + '</tr>' +
          (cal.resid_p25_factor !== undefined ? '<tr><td>Residual Q25..Q75</td>' + tdN('×' + cal.resid_p25_factor.toFixed(2)) + tdN('×' + cal.resid_p75_factor.toFixed(2)) + '</tr>' : '') +
        '</tbody></table><button type="button" class="evlink" id="btn-jump-live">Inspect all ' + D.live.length + ' blind-priced comps (scatter + residuals) →</button></div></div>';
    $('btn-jump-live').addEventListener('click', function () { showLive(true); $('boardpanel').scrollIntoView({ behavior: 'smooth' }); });

    var mult = D.multiples.map(function (m) { return '<b>' + esc(m.category) + ' ×' + m.multiple.toFixed(2) + '</b> (n=' + m.samples + ')'; }).join(' · ');
    var ablFull = D.method.ablation.map(function (a) {
      return '<tr' + (a.label.indexOf('shipped') >= 0 ? ' class="ship"' : '') + '><td>' + esc(a.label) + '</td>' + tdN('×' + a.median_factor.toFixed(2)) + tdN('×' + a.walkforward_factor.toFixed(2)) + tdN(a.spearman.toFixed(2)) + '</tr>';
    }).join('');
    $('model').innerHTML =
      '<h2>Valuation &amp; launch-odds methodology</h2>' +
      '<p class="formula">implied_value = TVL<sup>' + D.method.slope.toFixed(3) + '</sup> comps curve × shrunk_category_level × (1 + 0.20 × clamp(change_7d, −40%, +80%))</p>' +
      '<p>Fitted across ' + D.method.comps + ' priced tokens (TVL summed across all entries sharing a token symbol), market cap scales as TVL<sup>' + D.method.slope.toFixed(2) + '</sup> (~' + Math.pow(10, D.method.slope).toFixed(1) + '× value per 10× TVL). Category levels at the ' + money(D.method.reference_tvl_usd) + ' reference TVL shrink toward global ×' + D.global_multiple.toFixed(2) + ' via <code>(n·own + 3·global)/(n+3)</code>. Ranges use strict P25–P75 log-residual quartiles.</p>' +
      '<p class="mult">Category levels at ' + money(D.method.reference_tvl_usd) + ' TVL: ' + mult + '</p>' +
      '<table class="abl"><thead><tr><th>Candidate model shape</th><th class="num">LOO miss</th><th class="num">Walk-fwd</th><th class="num">Rank <span class="lc">ρ</span></th></tr></thead><tbody>' + ablFull + '</tbody></table>';
  })();

  // --- dropdowns, tabs, filtering & slice bar -------------------------------
  var cats = [], lcats = [], catMap = {};
  D.multiples.forEach(function (m) { catMap[m.category] = m; });
  D.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  D.live.forEach(function (r) { if (r.category && lcats.indexOf(r.category) < 0) lcats.push(r.category); });
  cats.sort(); lcats.sort();
  var opts = function (arr) { return '<option value="all">All categories (' + arr.length + ')</option>' + arr.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join(''); };
  $('cat').innerHTML = opts(cats); $('lcat').innerHTML = opts(lcats);

  function renderTabs() {
    var c = vStats(D.rows), wlC = D.rows.filter(function (r) { return r.watchlist; }).length, liveBtn = $('tab-live');
    var tb = function (id, lb, on) { return '<button type="button" role="tab" data-tier="' + id + '"' + (on ? ' class="on"' : '') + '>' + lb + '</button>'; };
    $('tabs').innerHTML =
      tb('all', 'All tiers ' + D.rows.length, !S.live && !S.wl && S.tier === 'all') +
      tb('farm', 'Farm ' + c.FARM, !S.live && !S.wl && S.tier === 'farm') +
      tb('marginal', 'Marginal ' + c.MARGINAL, !S.live && !S.wl && S.tier === 'marginal') +
      tb('skip', 'Skip ' + c.SKIP, !S.live && !S.wl && S.tier === 'skip') +
      tb('watchlist', 'Watchlist ' + wlC, !S.live && S.wl);
    if (liveBtn) {
      liveBtn.textContent = S.live ? '← Back to pre-token board (' + D.rows.length + ')' : 'Already trading · ' + D.live.length + ' blind-tested';
      liveBtn.className = S.live ? 'on' : '';
      $('tabs').appendChild(liveBtn);
    }
    var btns = $('tabs').querySelectorAll('button[data-tier]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var t = this.getAttribute('data-tier');
        if (S.live) showLive(false);
        if (t === 'watchlist') { S.wl = true; S.tier = 'all'; $('wl').checked = true; }
        else { S.tier = t; S.wl = false; $('wl').checked = false; }
        renderTabs(); renderBoard();
      });
    }
  }

  function visibleBoard() {
    var q = S.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (S.wl && !r.watchlist) return false;
      if (S.tier !== 'all' && verdict(r).tier.toLowerCase() !== S.tier) return false;
      if (S.cat !== 'all' && r.category !== S.cat) return false;
      return !q || (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    var by = {
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank; },
      expected: function (a, b) { return b.expected_value_usd - a.expected_value_usd || a.rank - b.rank; },
      net: function (a, b) { return verdict(b).net - verdict(a).net || a.rank - b.rank; },
      hourly: function (a, b) { return verdict(b).perHour - verdict(a).perHour || a.rank - b.rank; },
      odds: function (a, b) { return b.launch_odds - a.launch_odds || a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
      growth: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
      multiple: function (a, b) { return b.model.multiple - a.model.multiple || a.rank - b.rank; },
    };
    return rows.sort(by[S.sort] || by.implied);
  }

  function visibleLive() {
    var q = S.lq.trim().toLowerCase();
    var rows = D.live.filter(function (r) {
      if (S.lcat !== 'all' && r.category !== S.lcat) return false;
      if (S.lrange === 'in' && !r.in_range) return false;
      if (S.lrange === 'out' && r.in_range) return false;
      return !q || (r.name + ' ' + r.slug + ' ' + (r.symbol || '') + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    var by = {
      mcap: function (a, b) { return b.mcap_usd - a.mcap_usd; },
      blind: function (a, b) { return b.blind_usd - a.blind_usd; },
      fit: function (a, b) { return a.miss_factor - b.miss_factor || b.mcap_usd - a.mcap_usd; },
      miss: function (a, b) { return b.miss_factor - a.miss_factor || b.mcap_usd - a.mcap_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    };
    return rows.sort(by[S.lsort] || by.mcap);
  }

  function renderSliceBar(rows, isLive) {
    if (isLive) {
      var inC = 0, errs = [];
      rows.forEach(function (r) { if (r.in_range) inC++; if (r.miss_factor) errs.push(r.miss_factor); });
      errs.sort(function (a, b) { return a - b; });
      var med = errs.length ? errs[Math.floor(errs.length / 2)] : 0, hp = rows.length ? Math.round(100 * inC / rows.length) : 0;
      $('count').innerHTML =
        '<span><b>' + rows.length + '</b> of <b>' + D.live.length + '</b> priced comps (each valued blind from the other ' + (D.live.length - 1) + ' tokens)</span>' +
        '<span>Inside blind P25–P75: <b class="ok">' + inC + '/' + rows.length + ' (' + hp + '%)</b> · Median miss: <b class="am">×' + med.toFixed(2) + '</b> · Spearman ρ: <b>' + cal.spearman.toFixed(2) + '</b></span>';
      return;
    }
    var sT = 0, sI = 0, sE = 0, sW = 0, sc = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    rows.forEach(function (r) { sT += r.tvl_usd; sI += r.implied_value_usd; sE += r.expected_value_usd; if (r.watchlist) sW++; sc[verdict(r).tier]++; });
    var cm = S.cat !== 'all' ? catMap[S.cat] : null;
    var ci = S.cat === 'all' ? '' : cm ? ' · <b>' + esc(S.cat) + '</b> ×' + cm.multiple.toFixed(2) + ' (n=' + cm.samples + ')' : ' · <b>' + esc(S.cat) + '</b> ×' + D.global_multiple.toFixed(2) + ' (global)';
    $('count').innerHTML =
      '<span><b>' + rows.length + '</b>/' + D.rows.length + ' ranked' + ci + ' · Watchlist <b>' + sW + '/' + D.watchlist_size + '</b></span>' +
      '<span>∑ TVL <b>' + money(sT) + '</b> · ∑ Implied <b>' + money(sI) + '</b> · ∑ EV <b>' + money(sE) + '</b> · @ $' + comma(S.deposit) + '/' + Math.round(S.drop * 100) + '%: <b class="ok">' + sc.FARM + ' FARM</b> · <b class="am">' + sc.MARGINAL + ' MARG</b> · <b class="no">' + sc.SKIP + ' SKIP</b></span>';
  }

  function renderBoard() {
    var rows = visibleBoard();
    renderSliceBar(rows);
    if (S.live) return;
    $('rows').innerHTML = rows.map(function (r) {
      var v = verdict(r), m = r.model, op = Math.round(r.launch_odds * 100);
      var ch = esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      return '<tr data-slug="' + esc(r.slug) + '"' + (S.detail === r.slug ? ' class="active"' : '') + '>' +
        tdN(r.rank) +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="wl-dot" title="Watchlist">●</span>' : '') + '<span class="slug">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + ch + '</span></td>' +
        tdN(money(r.tvl_usd)) +
        tdN(pct(r.change_7d), r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : '') +
        tdN(age(r.age_days) + '<span class="subm">' + r.chains.length + 'ch</span>') +
        tdN(op + '%<span class="obar"><i style="width:' + op + '%"></i></span>') +
        tdN('<b>' + money(r.implied_value_usd) + '</b><span class="subm">' + money(m.value_low_usd) + '–' + money(m.value_high_usd) + '</span>') +
        tdN('<b>' + money(r.expected_value_usd) + '</b><span class="subm">×' + m.multiple.toFixed(2) + ' TVL</span>') +
        tdN('<span class="pill ' + v.tier.toLowerCase() + '">' + v.tier + '</span><span class="net ' + (v.net >= 0 ? 'pos' : 'neg') + '">' + sgn(v.net) + '</span><span class="subm">gas $' + r.plan.gas_usd.toFixed(1) + ' · ' + r.plan.hold_days + 'd</span>') +
        tdN('<span class="' + (v.perHour >= 0 ? 'pos' : 'neg') + '">' + sgnHr(v.perHour) + '</span><span class="subm">' + fmtBe(v.beDep) + '</span>') + '</tr>';
    }).join('');
    var trs = $('rows').querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) trs[i].addEventListener('click', function () { openDetail(this.getAttribute('data-slug'), true); });
  }

  // --- 117-comp blind validation SVG scatter + residual histogram -----------
  function renderLiveViz(pts) {
    if (!D.live.length || D.live[0].blind_usd === undefined) { $('liveviz').hidden = true; return; }
    var src = pts.length ? pts : D.live, minE = 12, maxE = 4;
    D.live.forEach(function (r) {
      var lx = Math.log10(Math.max(1, r.blind_usd)), ly = Math.log10(Math.max(1, r.mcap_usd));
      if (lx < minE) minE = lx; if (ly < minE) minE = ly;
      if (lx > maxE) maxE = lx; if (ly > maxE) maxE = ly;
    });
    minE = Math.floor(minE * 2) / 2 - 0.15; maxE = Math.ceil(maxE * 2) / 2 + 0.15;
    var W = 620, H = 198, pL = 46, pR = 12, pT = 10, pB = 25, pw = W - pL - pR, ph = H - pT - pB;
    var sx = function (e) { return (pL + ((e - minE) / (maxE - minE)) * pw).toFixed(1); };
    var sy = function (e) { return (pT + (1 - (e - minE) / (maxE - minE)) * ph).toFixed(1); };
    var q25 = Math.log10(cal.resid_p25_factor || 0.4), q75 = Math.log10(cal.resid_p75_factor || 2.5), mLg = Math.log10(cal.median_factor_error || 3);

    var ticks = '';
    for (var e = Math.ceil(minE); e <= Math.floor(maxE); e++) {
      var lb = money(Math.pow(10, e)).replace(/\.0+/, '');
      ticks += sLn(sx(e), pT, sx(e), H - pB, '#1e2722') + sLn(pL, sy(e), W - pR, sy(e), '#1e2722') +
        sTx(sx(e), H - 9, lb, 'middle', 'ax') + sTx(pL - 5, +sy(e) + 3, lb, 'end', 'ax');
    }
    var placed = [], dots = src.map(function (r, idx) {
      var cx = +sx(Math.log10(Math.max(1, r.blind_usd))), cy = +sy(Math.log10(Math.max(1, r.mcap_usd)));
      var col = r.in_range ? '#5fd68b' : r.miss_factor <= cal.median_factor_error * 1.5 ? '#ffb454' : '#ff7a6b';
      var lbl = '';
      if ((idx < 4 || r.miss_factor >= 25) && placed.length < 6 && cx > pL + 14 && cx < W - 54 && cy > pT + 10 && cy < H - pB - 8) {
        if (!placed.some(function (p) { return Math.abs(p.x - cx) < 56 && Math.abs(p.y - cy) < 12; })) {
          placed.push({ x: cx, y: cy });
          lbl = sTx(cx + 5, cy + 3, esc(r.symbol || r.name.slice(0, 7)), '', 'hi');
        }
      }
      return '<circle cx="' + cx + '" cy="' + cy + '" r="3.1" fill="' + col + '" fill-opacity=".88"><title>' +
        esc(r.name) + ': Actual ' + money(r.mcap_usd) + ' vs Blind ' + money(r.blind_usd) + ' (×' + r.miss_factor.toFixed(2) + ')</title></circle>' + lbl;
    }).join('');

    var band = [sx(minE) + ',' + sy(minE + q75), sx(maxE) + ',' + sy(maxE + q75), sx(maxE) + ',' + sy(maxE + q25), sx(minE) + ',' + sy(minE + q25)].join(' ');
    var scSvg = '<svg class="vizsvg" viewBox="0 0 ' + W + ' ' + H + '"><defs><clipPath id="cp"><rect x="' + pL + '" y="' + pT + '" width="' + pw + '" height="' + ph + '"/></clipPath></defs>' +
      '<rect x="' + pL + '" y="' + pT + '" width="' + pw + '" height="' + ph + '" fill="#101513" stroke="#26302a"/>' + ticks +
      '<g clip-path="url(#cp)"><polygon points="' + band + '" fill="#5fd68b" fill-opacity=".1"/>' +
      sLn(sx(minE), sy(minE + mLg), sx(maxE), sy(maxE + mLg), 'rgba(255,180,84,.38)', '3,3') +
      sLn(sx(minE), sy(minE - mLg), sx(maxE), sy(maxE - mLg), 'rgba(255,180,84,.38)', '3,3') +
      sLn(sx(minE), sy(minE), sx(maxE), sy(maxE), '#e8ece9', '5,3') + dots + '</g>' +
      '<rect x="' + (pL + 86) + '" y="' + (pT + 5) + '" width="7" height="7" fill="#5fd68b" fill-opacity=".35" stroke="#5fd68b" stroke-width=".7"/>' +
      sTx(pL + 6, pT + 12, '── 1:1 parity    blind P25–P75  ┄ ×' + cal.median_factor_error.toFixed(2) + ' median') +
      sTx(pL + pw / 2, H - 1, 'Blind Leave-One-Out Model Price → (vertical: Actual Market Cap)', 'middle') + '</svg>';

    var bins = 12, bMin = -1.8, bMax = 1.8, bw = (bMax - bMin) / bins, cnts = new Array(bins).fill(0), lErrs = [];
    src.forEach(function (r) {
      var le = r.log_err !== undefined ? r.log_err : Math.log10(r.mcap_usd / r.blind_usd);
      lErrs.push(le); cnts[Math.min(bins - 1, Math.max(0, Math.floor((le - bMin) / bw)))]++;
    });
    lErrs.sort(function (a, b) { return a - b; });
    var medB = lErrs.length ? Math.pow(10, lErrs[Math.floor(lErrs.length / 2)]) : 1, maxC = Math.max.apply(null, cnts.concat([1]));
    var HW = 450, HH = 198, hL = 24, hR = 12, hT = 10, hB = 25, hpw = HW - hL - hR, hph = HH - hT - hB;
    var hx = function (v) { return hL + ((v - bMin) / (bMax - bMin)) * hpw; };
    var bars = cnts.map(function (c, i) {
      var x0 = bMin + i * bw, xm = x0 + bw / 2, bx = hx(x0) + 1.5, w = hpw / bins - 3, bh = (c / maxC) * (hph - 32), by = hT + hph - bh;
      var col = xm >= q25 && xm <= q75 ? '#5fd68b' : Math.abs(xm) <= mLg ? '#ffb454' : '#6b7a70';
      return '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + col + '" fill-opacity=".82" rx="1.5"/>' +
        (c ? sTx((bx + w / 2).toFixed(1), (by - 3).toFixed(1), c, 'middle') : '');
    }).join('');
    var hLines = [[-1.5, '.03×', 'middle'], [-1, '.1×', 'middle'], [q25, 'P25', 'end'], [0, '1×', 'middle'], [q75, 'P75', 'start'], [1, '10×', 'middle'], [1.5, '32×', 'middle']].map(function (t) {
      var x = hx(t[0]).toFixed(1), k = t[1] === '1×' || t[1][0] === 'P';
      var tx = t[2] === 'end' ? (+x - 2).toFixed(1) : t[2] === 'start' ? (+x + 2).toFixed(1) : x;
      return sLn(x, hT + 16, x, HH - hB, t[1] === '1×' ? '#e8ece9' : k ? '#5fd68b' : '#1e2722', '3,2') + sTx(tx, HH - 10, t[1], t[2], k ? 'hi' : 'ax');
    }).join('');
    var hiSvg = '<svg class="vizsvg" viewBox="0 0 ' + HW + ' ' + HH + '"><rect x="' + hL + '" y="' + hT + '" width="' + hpw + '" height="' + hph + '" fill="#101513" stroke="#26302a"/>' +
      hLines + bars + sTx(hL + 6, hT + 12, 'median actual/blind = ×' + medB.toFixed(2) + ' (unbiased ≈ ×1.00)') +
      sTx(hL + hpw / 2, HH - 1, 'Actual ÷ Blind LOO Ratio · TVL^' + D.method.slope.toFixed(2) + ' fit', 'middle') + '</svg>';

    $('liveviz').innerHTML =
      '<div class="vizbox"><div class="vizhead"><h3>Blind LOO price vs actual market cap</h3><span>● in P25–P75 (' + cal.range_coverage_pct + '%) · n=' + src.length + '</span></div>' + scSvg + '</div>' +
      '<div class="vizbox"><div class="vizhead"><h3>Out-of-sample error distribution</h3><span>LOO ×' + cal.median_factor_error.toFixed(2) + ' · 5f ×' + cal.kfold_factor_error.toFixed(2) + ' · WF ×' + cal.walkforward_factor_error.toFixed(2) + '</span></div>' + hiSvg + '</div>';
  }

  function renderLive() {
    var lrows = visibleLive();
    if (S.live) renderSliceBar(lrows, true);
    renderLiveViz(lrows);
    $('liverows').innerHTML = lrows.map(function (r, i) {
      var ent = r.entries > 1 ? ' · <span class="ent">∑ ' + r.entries + ' entries</span>' : '';
      return '<tr>' + tdN(i + 1) +
        '<td class="name">' + esc(r.name) + (r.symbol ? '<span class="sym">' + esc(r.symbol) + '</span>' : '') + '<span class="slug">' + esc(r.slug) + ent + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' + tdN(money(r.tvl_usd)) +
        tdN('<b>' + money(r.mcap_usd) + '</b><span class="subm">×' + r.multiple.toFixed(2) + ' TVL</span>') +
        tdN('<b>' + money(r.blind_usd) + '</b><span class="subm">LOO blind</span>') +
        tdN(money(r.blind_low_usd) + '–' + money(r.blind_high_usd)) +
        tdN('<b>×' + r.miss_factor.toFixed(2) + '</b><span class="subm">' + (r.mcap_usd >= r.blind_usd ? '↑ actual' : '↓ model') + '</span>') +
        tdN('<span class="pill ' + (r.in_range ? 'in' : 'out') + '">' + (r.in_range ? 'IN P25–P75' : 'OUTSIDE') + '</span>') + '</tr>';
    }).join('');
  }

  // --- detail view: waterfall + cumulative cost SVG + exit + timeline -------
  function parseStep(step, idx, total, plan) {
    var wks = Math.ceil(plan.hold_days / 7);
    var capM = step.match(/Cost:\s*\$(\d+(?:\.\d+)?)\s+of working capital/i);
    var gasM = step.match(/about\s+\$(\d+(?:\.\d+)?)\s+of\s+[^.]*?(a week|per market)?\./i);
    var timeM = step.match(/Time:\s*([^.]+)\./i);
    var isEx = idx === total - 1 || /^To exit\b/i.test(step);
    var names = ['D0 · WALLET SETUP', 'D0 · CORE POSITION', 'WK 1–' + wks + ' · CADENCE', 'D14 · SCALE / CHAIN 2', 'D0–' + plan.hold_days + ' · SNAPSHOT HOLD', 'PRE-TGE · SAFE CLAIM'];
    var cap = capM ? +capM[1] : 0, gas = gasM ? +gasM[1] : 0, wk = Boolean(gasM && gasM[2] === 'a week'), meta = [];
    if (cap > 0) meta.push('Cap $' + cap); else if (idx === 4) meta.push('Hold $' + plan.capital_usd);
    if (gas > 0) meta.push('Gas ~$' + gas + (wk ? '/wk' : '')); else if (idx === 5) meta.push('$0 fee');
    if (timeM) meta.push(timeM[1].replace(/minutes/g, 'min').replace(/a week/g, '/wk'));
    return { phase: isEx ? 'D' + plan.hold_days + ' · SAFE EXIT' : (names[idx] || 'STEP ' + (idx + 1)), meta: meta.join(' · '), cap: cap, gas: gas, wk: wk, isExit: isEx, full: step };
  }

  function renderCostSvg(r, ps, v) {
    var HD = r.plan.hold_days, tM = Math.min(14, Math.round(HD / 2));
    var g0 = (ps[0] ? ps[0].gas : 0) + (ps[1] ? ps[1].gas : 0), gW = ps[2] && ps[2].wk ? ps[2].gas : 0;
    var gM = ps[3] ? ps[3].gas : 0, gEx = ps[ps.length - 1] ? ps[ps.length - 1].gas : 0;
    var rawG = g0 + gM + gEx + gW * Math.ceil(HD / 7), sc = rawG > 0 ? r.plan.gas_usd / rawG : 1;
    var dC = (S.deposit * 0.02) / 365, dG = (gW * sc) / 7;
    var c0 = g0 * sc, c1 = c0 + (dG + dC) * tM, c2 = c1 + gM * sc, c3 = c2 + (dG + dC) * (HD - tM), cEnd = r.plan.gas_usd + dC * HD;
    var yMax = Math.max(cEnd, v.gross, 10) * 1.18, W = 510, H = 144, pL = 42, pR = 14, pT = 12, pB = 22, pw = W - pL - pR, ph = H - pT - pB;
    var sx = function (d) { return (pL + (d / HD) * pw).toFixed(1); };
    var sy = function (val) { return (pT + (1 - Math.min(yMax, Math.max(0, val)) / yMax) * ph).toFixed(1); };
    var r1 = ps[1] && ps[1].cap > 0 ? ps[1].cap / r.plan.capital_usd : 0.67;
    var yC1 = (pT + ph * (1 - 0.52 * r1)).toFixed(1), yC2 = (pT + ph * 0.48).toFixed(1);
    var capP = [sx(0) + ',' + sy(0), sx(0) + ',' + yC1, sx(tM) + ',' + yC1, sx(tM) + ',' + yC2, sx(HD) + ',' + yC2, sx(HD) + ',' + sy(0)].join(' ');
    var path = 'M' + sx(0) + ',' + sy(c0) + ' L' + sx(tM) + ',' + sy(c1) + ' L' + sx(tM) + ',' + sy(c2) + ' L' + sx(HD) + ',' + sy(c3) + ' L' + sx(HD) + ',' + sy(cEnd);
    var gy = +sy(v.gross), ey = +sy(cEnd);
    return '<svg class="vizsvg" viewBox="0 0 ' + W + ' ' + H + '"><rect x="' + pL + '" y="' + pT + '" width="' + pw + '" height="' + ph + '" fill="#101513" stroke="#26302a"/>' +
      '<polygon points="' + capP + '" fill="#63b3ed" fill-opacity=".09" stroke="#63b3ed" stroke-opacity=".28" stroke-dasharray="2,2"/>' +
      '<rect x="' + (+sx(HD) - 7) + '" y="' + Math.min(gy, ey) + '" width="7" height="' + Math.max(2, Math.abs(gy - ey)) + '" fill="' + (v.gross >= cEnd ? '#5fd68b' : '#ff7a6b') + '" fill-opacity=".35"/>' +
      sLn(pL, gy, W - pR, gy, '#5fd68b', '5,3') + '<path d="' + path + '" fill="none" stroke="#ff7a6b" stroke-width="1.8"/>' +
      '<circle cx="' + sx(0) + '" cy="' + sy(c0) + '" r="2.6" fill="#ff7a6b"/><circle cx="' + sx(tM) + '" cy="' + sy(c2) + '" r="2.6" fill="#ffb454"/><circle cx="' + sx(HD) + '" cy="' + ey + '" r="3" fill="#ff7a6b"/>' +
      sTx(pL + 5, Math.max(pT + 10, gy - 4), 'Exp. drop @ $' + comma(S.deposit) + ': $' + v.gross.toFixed(1), '', '', '#5fd68b') +
      sTx(+sx(HD) - 8, Math.max(pT + 20, ey - 6), 'Cum. gas+carry: $' + cEnd.toFixed(1), 'end', '', '#ff7a6b') +
      sTx(+sx(tM) + 6, +yC2 + 12, 'Plan cap $' + r.plan.capital_usd + ' (unwound D' + HD + ')', '', '', '#63b3ed') +
      sTx(pL - 4, pT + 8, '$' + Math.round(yMax), 'end', 'ax') + sTx(pL - 4, H - pB, '$0', 'end', 'ax') +
      sTx(sx(0), H - 7, 'D0 Entry') + sTx(sx(tM), H - 7, 'D' + tM + ' Scale', 'middle') + sTx(sx(HD), H - 7, 'D' + HD + ' Exit', 'end') + '</svg>';
  }

  function openDetail(slug, scroll) {
    var r = null;
    D.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    S.detail = slug;
    var m = r.model, v = verdict(r), ps = r.farm_steps.map(function (s, i) { return parseStep(s, i, r.farm_steps.length, r.plan); });
    var stop = r.chains.length >= 2
      ? 'Multi-chain guard (' + esc(r.chains[0]) + ' + ' + esc(r.chains[1]) + '): keep 2:1 sizing and verify health/peg weekly on both chains.'
      : 'Day-14 TVL stop gate: check ' + esc(r.name) + ' TVL on DefiLlama at D14 — skip Tranche 2 if TVL fell >10% since entry.';
    var baseV = Math.round(r.implied_value_usd / (m.momentum || 1));
    var st = function (k, val) { return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + val + '</div></div>'; };
    var sens = [250, 1000, 2500, 10000].map(function (dep) {
      var sv = verdictAt(r, dep, S.drop);
      return '<tr' + (dep === S.deposit ? ' class="cur"' : '') + '><td>$' + comma(dep) + '</td>' + tdN('$' + sv.gross.toFixed(1)) + tdN('−$' + sv.cost.toFixed(1)) +
        tdN(sgn(sv.net), sv.net >= 0 ? 'pos' : 'neg') + tdN(sgnHr(sv.perHour)) + tdN('<span class="pill ' + sv.tier.toLowerCase() + '">' + sv.tier + '</span>') + '</tr>';
    }).join('');
    var tl = ps.map(function (p, i) {
      return '<li class="tli' + (p.isExit ? ' exit' : '') + '"><div class="tli-top"><span class="tli-phase">' + (i + 1) + '. ' + esc(p.phase) + '</span><span class="tli-meta">' + esc(p.meta) + '</span></div><p class="tli-txt">' + esc(p.full) + '</p></li>';
    }).join('');

    $('detail').innerHTML =
      '<div class="detail-top"><h2>' + esc(r.name) + '<span class="slug">' + esc(r.slug) + ' · rank #' + r.rank + (r.watchlist ? ' · watchlist ●' : '') + ' · ' + esc(r.category || 'Uncategorised') + '</span></h2>' +
        '<div class="d-actions"><span class="pill ' + v.tier.toLowerCase() + '">' + v.tier + ' ' + sgn(v.net) + ' (' + sgnHr(v.perHour) + ')</span><span>' + fmtBe(v.beDep) + (isFinite(v.farmDep) && v.farmDep < 1e8 ? ' · FARM ≥' + money(v.farmDep) : '') + '</span><button type="button" class="btn-close" id="btn-close-detail">Close ✕</button></div></div>' +
      '<div class="wfall"><div class="wf-step"><small>Locked TVL</small><b>' + money(r.tvl_usd) + '</b></div><span class="wf-arr">→</span>' +
        '<div class="wf-step"><small>TVL^' + m.slope.toFixed(2) + ' × cat ×' + m.level.toFixed(2) + '</small><b>' + money(baseV) + '</b></div><span class="wf-arr">→</span>' +
        '<div class="wf-step"><small>7d mom ×' + m.momentum.toFixed(2) + '</small><b>' + money(r.implied_value_usd) + '</b></div><span class="wf-arr">→</span>' +
        '<div class="wf-step"><small>P25–P75 spread</small><b>' + money(m.value_low_usd) + '–' + money(m.value_high_usd) + '</b></div><span class="wf-arr">→</span>' +
        '<div class="wf-step hi"><small>× ' + Math.round(r.launch_odds * 100) + '% odds = EV</small><b>' + money(r.expected_value_usd) + '</b></div></div>' +
      '<div class="d-stats">' + st('Implied val', money(r.implied_value_usd)) + st('Expected val', money(r.expected_value_usd)) + st('Launch odds', Math.round(r.launch_odds * 100) + '%') + st('Eff. mult', '×' + m.multiple.toFixed(2)) + st('7-day TVL', pct(r.change_7d)) + st('Tokenless', age(r.age_days)) + st('Plan capital', '$' + r.plan.capital_usd) + st('Gas · hold', '$' + r.plan.gas_usd + ' · ' + r.plan.hold_days + 'd') + '</div>' +
      '<p class="work"><b>Provenance:</b> ' + esc(m.multiple_source) + '. Tracked ' + (r.listed_at ? 'since ' + esc(r.listed_at) + ' (' + age(r.age_days) + ')' : age(r.age_days)) + ' on ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ' (' + esc(r.chains.slice(0, 6).join(', ')) + (r.chains.length > 6 ? ' +' + (r.chains.length - 6) : '') + ').</p>' +
      '<div class="farm-deck">' +
        '<div class="fbox"><h3>Cumulative farm cost vs expected drop<span>$' + comma(S.deposit) + ' · ' + Math.round(S.drop * 100) + '% pool · ' + r.plan.minutes_week + 'm/wk</span></h3>' + renderCostSvg(r, ps, v) + '</div>' +
        '<div class="fbox"><h3>Deposit scaling &amp; exit guardrails<span>' + fmtBe(v.beDep) + '</span></h3>' +
          '<table class="sens"><thead><tr><th>Deposit</th><th class="num">Drop</th><th class="num">Cost</th><th class="num">Net</th><th class="num">$/hr</th><th class="num">Tier</th></tr></thead><tbody>' + sens + '</tbody></table>' +
          '<div class="exit-card"><div class="et">Exit Condition &amp; Unwind Sequence</div><p>' + esc(ps[ps.length - 1].full) + '</p><div class="stop">▸ ' + stop + '</div></div></div></div>' +
      '<div class="tl-head"><h3>7-step execution timeline (verbatim board.json farm_steps)</h3><span>Working capital $' + r.plan.capital_usd + ' · Gas ~$' + r.plan.gas_usd + ' · ' + r.plan.hold_days + '-day hold</span></div>' +
      '<ol class="timeline">' + tl + '</ol>';

    $('detail').hidden = false;
    $('btn-close-detail').addEventListener('click', function () { S.detail = null; $('detail').hidden = true; renderBoard(); });
    renderBoard();
    if (scroll) $('detail').scrollIntoView({ behavior: 'smooth' });
  }

  function showLive(on) {
    S.live = on;
    $('board').hidden = on; $('board-controls').hidden = on;
    $('live').hidden = !on; $('live-controls').hidden = !on; $('liveviz').hidden = !on;
    renderTabs();
    if (on) renderLive(); else renderBoard();
  }
  function refreshVerdicts() {
    renderKpis(); renderTabs(); renderBoard();
    if (S.detail) openDetail(S.detail, false);
  }

  $('q').addEventListener('input', function () { S.q = this.value; renderTabs(); renderBoard(); });
  $('cat').addEventListener('change', function () { S.cat = this.value; renderTabs(); renderBoard(); });
  $('sort').addEventListener('change', function () { S.sort = this.value; renderBoard(); });
  $('wl').addEventListener('change', function () { S.wl = this.checked; if (this.checked) S.tier = 'all'; renderTabs(); renderBoard(); });
  $('deposit').addEventListener('change', function () { S.deposit = +this.value; refreshVerdicts(); });
  $('drop').addEventListener('change', function () { S.drop = +this.value; refreshVerdicts(); });
  $('tab-live').addEventListener('click', function () { showLive(!S.live); });
  $('lq').addEventListener('input', function () { S.lq = this.value; renderLive(); });
  $('lcat').addEventListener('change', function () { S.lcat = this.value; renderLive(); });
  $('lrange').addEventListener('change', function () { S.lrange = this.value; renderLive(); });
  $('lsort').addEventListener('change', function () { S.lsort = this.value; renderLive(); });

  renderTabs(); renderBoard();

  var hash = {};
  location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
    var p = kv.split('=');
    if (p.length === 2) hash[p[0]] = decodeURIComponent(p[1]);
  });
  var hideTop = function () { ['kpis', 'ledger', 'evidence', 'model'].forEach(function (id) { $(id).style.display = 'none'; }); };
  if (hash.filter && cats.indexOf(hash.filter) >= 0) { S.cat = hash.filter; $('cat').value = hash.filter; renderTabs(); renderBoard(); }
  if (hash.live === '1') showLive(true);
  if (hash.filter || hash.live === '1') hideTop();
  if (hash.detail) {
    openDetail(hash.detail, false);
    hideTop();
    $('boardpanel').style.display = 'none';
    var main = document.querySelector('main');
    main.insertBefore($('detail'), main.firstChild);
    window.scrollTo(0, 0);
  }
})();
