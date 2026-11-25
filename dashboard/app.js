// Launch Radar page. Reads window.RADAR (data.js, written by main.ts from
// the same board as board.json) and renders: the model and the multiples it
// learned, a sortable/filterable board, a per-protocol detail view with the
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
  var state = { q: '', cat: 'all', sort: 'implied', wl: false, live: false, detail: null };

  function money(n) {
    if (n === null || n === undefined) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
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

  // --- header + model panel -------------------------------------------------
  $('sub').textContent =
    D.board_size + ' protocols ranked · every one of the ' + D.watchlist_size +
    ' watchlist protocols covered · snapshot as of ' + D.as_of + ' · model ' + D.model_version + '.';
  var mult = D.multiples.slice(0, 8).map(function (m) {
    return '<b>' + esc(m.category) + ' ×' + m.multiple.toFixed(2) + '</b> (' + m.samples + ' traded)';
  }).join(' · ');
  $('model').innerHTML =
    '<h2>How a launch is valued here</h2>' +
    '<p class="formula">implied value = TVL × category multiple × momentum × breadth × maturity</p>' +
    '<p>The category multiple is the market\u2019s own price for a dollar of TVL: the median market-cap/TVL ' +
    'ratio of the protocols in that category that already trade, shrunk toward the global median ' +
    '(×' + D.global_multiple.toFixed(2) + ') when a category has few traded members. Momentum follows the ' +
    '7-day TVL change (clamped to −40%…+80%, weight 0.35), breadth adds 3% per extra chain up to six, and ' +
    'maturity rises from 0.70 to 1.00 over three years run with no token recorded. Wrapped, staked and ' +
    'bridged products of tokens that already trade — WBTC, Binance staked ETH, USDT0 and their kin — are ' +
    'kept off the board by the same rule that built the watchlist.</p>' +
    '<p class="mult">Learned multiples: ' + mult + '</p>';

  // --- controls ---------------------------------------------------------------
  var cats = [];
  D.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  $('cat').innerHTML = '<option value="all">All categories</option>' + cats.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  function visible() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
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
      ? D.live.length + ' already-trading protocols, by market cap — the evidence the multiples are learned from'
      : rows.length + ' of ' + D.rows.length + ' protocols shown';
    $('rows').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? ' <span class="wl-dot" title="On the watchlist">●</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : '') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">×' + r.model.multiple.toFixed(2) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td></tr>';
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
    var stat = function (k, v) { return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; };
    $('detail').innerHTML =
      '<h2>' + esc(r.name) + '<span class="slug">' + esc(r.slug) + ' · rank #' + r.rank +
      (r.watchlist ? ' · on the watchlist' : '') + '</span></h2>' +
      '<div class="grid">' +
      stat('Implied value', money(r.implied_value_usd)) + stat('TVL', money(r.tvl_usd)) +
      stat('Category multiple', '×' + m.multiple.toFixed(2)) + stat('Momentum', '×' + m.momentum.toFixed(2)) +
      stat('Breadth', '×' + m.breadth.toFixed(2)) + stat('Maturity', '×' + m.maturity.toFixed(2)) +
      stat('Time tokenless', age(r.age_days)) + stat('7-day TVL', pct(r.change_7d)) + '</div>' +
      '<p class="work">' + esc(r.name) + ' is valued from its own figures: ' + money(r.tvl_usd) + ' of TVL × ' +
      m.multiple.toFixed(2) + ' — ' + esc(m.multiple_source) + ' — then ×' + m.momentum.toFixed(2) + ' for its ' +
      '7-day momentum, ×' + m.breadth.toFixed(2) + ' for running on ' + r.chains.length + ' chain' +
      (r.chains.length === 1 ? '' : 's') + ' (' + esc(r.chains.join(', ')) + '), and ×' + m.maturity.toFixed(2) +
      ' for ' + age(r.age_days) + ' run with no token recorded' +
      (r.listed_at ? ' (tracked since ' + esc(r.listed_at) + ')' : '') + '.</p>' +
      '<h2>Farm plan</h2><ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
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

  $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); });
  $('sort').addEventListener('change', function () { state.sort = this.value; renderBoard(); });
  $('wl').addEventListener('change', function () { state.wl = this.checked; renderBoard(); });
  $('tab-live').addEventListener('click', function () { showLive(!state.live); });

  renderLive();
  renderBoard();

  // Hash-addressed views (used for the entry's screenshots).
  var hash = {};
  location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
    var p = kv.split('=');
    if (p.length === 2) hash[p[0]] = decodeURIComponent(p[1]);
  });
  if (hash.filter && cats.indexOf(hash.filter) >= 0) { state.cat = hash.filter; $('cat').value = hash.filter; renderBoard(); }
  if (hash.live === '1') showLive(true);
  if (hash.detail) {
    // Screenshot mode: bring the detail to the top of the page instead of
    // scrolling to it, so a fixed-size capture frames it exactly.
    openDetail(hash.detail);
    var main = document.querySelector('main');
    $('model').hidden = true;
    main.insertBefore($('detail'), main.firstChild);
    window.scrollTo(0, 0);
  }
})();
