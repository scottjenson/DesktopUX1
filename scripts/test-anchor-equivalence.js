#!/usr/bin/env node
// HISTORICAL: This script was used to tune the multi-signal anchor-inference
// weights. The validation target was the labeled (is_anchored=true) set in
// the original JSON, plus places that qualified by hub structure or high dwell.
// Once a weighting was found that matched the target set with a wide margin,
// the inference logic was shipped to viewer/js/anchor-data.js and the
// is_anchored field was removed from the JSON.
//
// The script still runs and serves as a regression check: it asserts that the
// current scoring identifies the expected 6 anchors. If the dataset changes,
// update EXPECTED_ANCHORS below.
//
// Usage: node scripts/test-anchor-equivalence.js

const EXPECTED_ANCHORS = new Set([
  'https://google.com/search?q=best+mid-drive+commuter+ebike',
  'https://specialized.com/us/en/turbo-vado-4',
  'https://trekbikes.com/us/en_US/allant-plus-7',
  'https://gazellebikes.com/en-us/ultimate-c8',
  'slack://app',
  'KEEP',
]);

const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'viewer', 'history2.json'), 'utf8'));

// Mirrors viewer/js/url-utils.js normUrl
function normUrl(u) {
  if (!u) return u;
  if (u.indexOf('keep.google.com') !== -1) return 'KEEP';
  return u;
}

// Build per-place aggregates and per-node trigger reasons, mirroring the logic
// in viewer/js/anchor-data.js (prepareAnchorData).
function analyze(flat) {
  const childCount = new Map();
  flat.forEach(n => {
    if (n.parent_node_id)
      childCount.set(n.parent_node_id, (childCount.get(n.parent_node_id) || 0) + 1);
  });

  const byUrl = new Map();
  flat.forEach(node => {
    const url = normUrl(node.url);
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        url, page_title: node.page_title,
        visits: 0,
        totalDwell: 0,
        maxDwell: 0,
        copies: 0,
        scrollDepths: [],
        maxChildren: 0,
        transitionTypes: new Set(),
      });
    }
    const place = byUrl.get(url);

    place.visits++;
    place.totalDwell += node.active_signals.dwell_time_seconds;
    place.maxDwell    = Math.max(place.maxDwell, node.active_signals.dwell_time_seconds);
    if (node.active_signals.clipboard_copy_event) place.copies++;
    place.scrollDepths.push(node.active_signals.max_scroll_depth_percent ?? 0);
    place.maxChildren = Math.max(place.maxChildren, childCount.get(node.node_id) || 0);
    if (node.transition_type) place.transitionTypes.add(node.transition_type);
  });

  // Infer pastes received: each copy event lands on the next-visited KEEP instance
  const pastesByUrl = new Map();
  flat.forEach((node, i) => {
    if (!node.active_signals.clipboard_copy_event) return;
    for (let j = i + 1; j < flat.length; j++) {
      if (normUrl(flat[j].url) === 'KEEP') {
        pastesByUrl.set('KEEP', (pastesByUrl.get('KEEP') || 0) + 1);
        break;
      }
    }
  });
  for (const [url, p] of byUrl) p.pastesReceived = pastesByUrl.get(url) || 0;

  return byUrl;
}

const places = analyze(data);

const rows = [...places.values()].map(p => ({
  url: p.url,
  title: p.page_title,
  visits: p.visits,
  totalDwell: p.totalDwell,
  maxDwell: p.maxDwell,
  copies: p.copies,
  avgScroll: p.scrollDepths.length ? Math.round(p.scrollDepths.reduce((a,b)=>a+b,0) / p.scrollDepths.length) : 0,
  maxScroll: Math.max(0, ...p.scrollDepths),
  maxChildren: p.maxChildren,
  pastesReceived: p.pastesReceived,
  transitions: [...p.transitionTypes].join('/'),
}));

function fmtSignals(r) {
  return `visits=${r.visits} dwell=${r.totalDwell}s(max ${r.maxDwell}s) copies=${r.copies} scroll=avg${r.avgScroll}%/max${r.maxScroll}% maxChildren=${r.maxChildren} pastes=${r.pastesReceived} trans=[${r.transitions}]`;
}

console.log('='.repeat(78));
console.log('Anchor inference regression check');
console.log('='.repeat(78));
console.log(`Total places: ${rows.length}`);
console.log();

// ────────────────────────────────────────────────────────────────────────────
// Inferred-anchor scoring — multi-signal additive score, top-K selection
// ────────────────────────────────────────────────────────────────────────────

// Score components — each signal contributes additively.
// Weights tuned via grid search to match the labeled anchor set exactly with
// the widest possible margin between rank-6 (last anchor) and rank-7 (first non-anchor).
const W_DWELL_ACTIVE = 0.3;   // dwell_seconds × (max_scroll_pct/100) — heavily discounted
const W_COPY         = 150;   // each copy is a strong active-engagement signal
const W_PASTE        = 80;    // paste destination = strong sink signal
const W_HUB_PER_CHILD = 120;  // bonus per child beyond 2 — structural pivots matter
const W_HUB_CAP      = 5;     // cap on children for hub bonus
const W_FALLBACK     = 250;   // dwell-only fallback for under-instrumented sources (Slack)
const HIGH_DWELL_S   = 700;   // raw dwell threshold for fallback eligibility

function score(r) {
  const activeDwell = r.maxDwell * (r.maxScroll / 100);
  const hub_bonus   = Math.min(W_HUB_CAP, Math.max(0, r.maxChildren - 2)) * W_HUB_PER_CHILD;
  const fallback    = (r.maxDwell > HIGH_DWELL_S) ? W_FALLBACK : 0;
  return {
    total: W_DWELL_ACTIVE * activeDwell
         + W_COPY  * r.copies
         + W_PASTE * r.pastesReceived
         + hub_bonus + fallback,
    parts: { activeDwell, copies: r.copies, pastes: r.pastesReceived, hub_bonus, fallback },
  };
}

const SCORE_THRESHOLD = 200;   // matches viewer/js/anchor-data.js ANCHOR_SCORE_THRESHOLD

const scored = rows.map(r => ({ ...r, score: score(r) }))
  .sort((a, b) => b.score.total - a.score.total);

const inferredAnchors = new Set(scored.filter(r => r.score.total >= SCORE_THRESHOLD).map(r => r.url));

console.log(`Weights: activeDwell×${W_DWELL_ACTIVE}  copy×${W_COPY}  paste×${W_PASTE}  hub×${W_HUB_PER_CHILD}/child(cap ${W_HUB_CAP})  fallback×${W_FALLBACK}(>${HIGH_DWELL_S}s dwell)`);
console.log(`Threshold: score >= ${SCORE_THRESHOLD}`);
console.log();

function fmtScoreParts(p) {
  const parts = [];
  if (p.activeDwell > 0) parts.push(`active=${Math.round(p.activeDwell)}`);
  if (p.copies)          parts.push(`copy×${p.copies}=${W_COPY * p.copies}`);
  if (p.pastes)          parts.push(`paste×${p.pastes}=${W_PASTE * p.pastes}`);
  if (p.hub_bonus)       parts.push(`hub=${p.hub_bonus}`);
  if (p.fallback)        parts.push(`fallback=${p.fallback}`);
  return parts.join(' + ');
}

console.log(`Rank  Score   Inferred?  Expected?  URL`);
console.log('-'.repeat(78));
const showCount = Math.max(EXPECTED_ANCHORS.size + 4, inferredAnchors.size + 2);
for (let i = 0; i < Math.min(scored.length, showCount); i++) {
  const r = scored[i];
  const inferred = inferredAnchors.has(r.url) ? 'YES' : ' no';
  const expected = EXPECTED_ANCHORS.has(r.url) ? 'YES' : ' no';
  const match    = (inferred === 'YES') === (expected === 'YES') ? '  ' : '⚠ ';
  console.log(`${match}${String(i + 1).padStart(3)}.  ${String(Math.round(r.score.total)).padStart(5)}   ${inferred}        ${expected}        ${r.url}`);
  console.log(`              ${fmtScoreParts(r.score.parts)}`);
}
console.log();

const missedInf = [...EXPECTED_ANCHORS].filter(u => !inferredAnchors.has(u));
const extraInf  = [...inferredAnchors].filter(u => !EXPECTED_ANCHORS.has(u));
const matchedInf = [...inferredAnchors].filter(u => EXPECTED_ANCHORS.has(u));

console.log('--- Inference vs. expected anchors ---');
console.log(`Matched:  ${matchedInf.length} / ${EXPECTED_ANCHORS.size}`);
if (missedInf.length) {
  console.log(`Missed (expected but not inferred):`);
  for (const u of missedInf) console.log(`  - ${u}`);
}
if (extraInf.length) {
  console.log(`Extra (inferred but not expected):`);
  for (const u of extraInf) console.log(`  - ${u}`);
}
console.log();

if (missedInf.length === 0 && extraInf.length === 0) {
  console.log('RESULT: PASS — inferred anchor set matches labeled set exactly.');
  process.exit(0);
} else {
  console.log('RESULT: DIFF — tune weights or threshold and re-run.');
  process.exit(1);
}
