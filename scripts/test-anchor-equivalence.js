#!/usr/bin/env node
// Compares the current anchor-detection logic (which uses node.is_anchored as one
// of three OR'd triggers) against a proposed version that drops the is_anchored
// branch. Reports per-place which trigger(s) fired, and whether the two anchor
// sets agree.
//
// Usage: node scripts/test-anchor-equivalence.js

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
        triggers: { is_anchored: [], hub: [], highDwell: [] },
        visits: 0,
        totalDwell: 0,
        maxDwell: 0,
        copies: 0,
        selectionEvaporated: 0,
        scrollDepths: [],
        maxChildren: 0,
        transitionTypes: new Set(),
      });
    }
    const place = byUrl.get(url);
    const isHub = (childCount.get(node.node_id) || 0) >= 3;
    const isHighDwell = node.active_signals.dwell_time_seconds > 700;

    if (node.is_anchored) place.triggers.is_anchored.push(node.node_id);
    if (isHub)            place.triggers.hub.push(node.node_id);
    if (isHighDwell)      place.triggers.highDwell.push(node.node_id);

    place.visits++;
    place.totalDwell += node.active_signals.dwell_time_seconds;
    place.maxDwell    = Math.max(place.maxDwell, node.active_signals.dwell_time_seconds);
    if (node.active_signals.clipboard_copy_event) place.copies++;
    if (node.active_signals.selection_evaporated) place.selectionEvaporated++;
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

// Determine anchor status under the two regimes
function isAnchorCurrent(p) {
  return p.triggers.is_anchored.length > 0 ||
         p.triggers.hub.length > 0 ||
         p.triggers.highDwell.length > 0;
}
function isAnchorProposed(p) {
  return p.triggers.hub.length > 0 ||
         p.triggers.highDwell.length > 0;
}

const rows = [...places.values()].map(p => ({
  url: p.url,
  title: p.page_title,
  current: isAnchorCurrent(p),
  proposed: isAnchorProposed(p),
  triggers: p.triggers,
  visits: p.visits,
  totalDwell: p.totalDwell,
  maxDwell: p.maxDwell,
  copies: p.copies,
  selectionEvaporated: p.selectionEvaporated,
  avgScroll: p.scrollDepths.length ? Math.round(p.scrollDepths.reduce((a,b)=>a+b,0) / p.scrollDepths.length) : 0,
  maxScroll: Math.max(0, ...p.scrollDepths),
  maxChildren: p.maxChildren,
  pastesReceived: p.pastesReceived,
  transitions: [...p.transitionTypes].join('/'),
}));

// Sort: anchors first, then by URL
rows.sort((a, b) => (b.current - a.current) || a.url.localeCompare(b.url));

// Report
const matched = [];
const lostAnchors = [];   // anchor in current, not in proposed (regression)
const newAnchors  = [];   // anchor in proposed, not in current (unlikely but possible)

for (const r of rows) {
  if (r.current && r.proposed) matched.push(r);
  else if (r.current && !r.proposed) lostAnchors.push(r);
  else if (!r.current && r.proposed) newAnchors.push(r);
}

function fmtTriggers(t) {
  const parts = [];
  if (t.is_anchored.length) parts.push(`is_anchored×${t.is_anchored.length}`);
  if (t.hub.length)         parts.push(`hub×${t.hub.length}`);
  if (t.highDwell.length)   parts.push(`highDwell×${t.highDwell.length}`);
  return parts.join(', ') || '(none)';
}

console.log('='.repeat(78));
console.log('Anchor equivalence test: current logic vs. proposed (drop is_anchored)');
console.log('='.repeat(78));
console.log();

console.log(`Total places: ${rows.length}`);
console.log(`Current anchors:  ${rows.filter(r => r.current).length}`);
console.log(`Proposed anchors: ${rows.filter(r => r.proposed).length}`);
console.log();

function fmtSignals(r) {
  return `visits=${r.visits} dwell=${r.totalDwell}s(max ${r.maxDwell}s) copies=${r.copies} selEvap=${r.selectionEvaporated} scroll=avg${r.avgScroll}%/max${r.maxScroll}% maxChildren=${r.maxChildren} pastes=${r.pastesReceived} trans=[${r.transitions}]`;
}

console.log('--- Anchors in current logic ---');
for (const r of rows.filter(r => r.current)) {
  const status = r.proposed ? '  KEPT' : '  LOST';
  console.log(`${status}  [${fmtTriggers(r.triggers)}]  ${r.url}`);
  console.log(`            "${r.title}"`);
  console.log(`            ${fmtSignals(r)}`);
}
console.log();

console.log('--- Top non-anchors by total dwell (for comparison) ---');
const nonAnchors = rows.filter(r => !r.current)
  .sort((a, b) => b.totalDwell - a.totalDwell)
  .slice(0, 8);
for (const r of nonAnchors) {
  console.log(`        ${r.url}`);
  console.log(`            "${r.title}"`);
  console.log(`            ${fmtSignals(r)}`);
}
console.log();

if (lostAnchors.length === 0 && newAnchors.length === 0) {
  console.log('Equivalence check: PASS — current and proposed (drop is_anchored) sets are identical.');
} else {
  console.log('Equivalence check: DIFF');
  if (lostAnchors.length) {
    console.log(`  ${lostAnchors.length} place(s) would lose anchor status under "drop is_anchored":`);
    for (const r of lostAnchors) console.log(`    - ${r.url}  [${fmtTriggers(r.triggers)}]`);
  }
  if (newAnchors.length) {
    console.log(`  ${newAnchors.length} place(s) would gain anchor status:`);
    for (const r of newAnchors) console.log(`    - ${r.url}  [${fmtTriggers(r.triggers)}]`);
  }
}
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
const W_SEL_EVAP     = 20;    // near-copy
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
         + W_SEL_EVAP * r.selectionEvaporated
         + hub_bonus + fallback,
    parts: { activeDwell, copies: r.copies, pastes: r.pastesReceived, selEvap: r.selectionEvaporated, hub_bonus, fallback },
  };
}

const TOP_K = rows.filter(r => r.current).length;  // match the current anchor count

const scored = rows.map(r => ({ ...r, score: score(r) }))
  .sort((a, b) => b.score.total - a.score.total);

const inferredAnchors = new Set(scored.slice(0, TOP_K).map(r => r.url));
const labeledAnchors  = new Set(rows.filter(r => r.current).map(r => r.url));

console.log('='.repeat(78));
console.log(`Inferred anchors (multi-signal score, top-${TOP_K})`);
console.log('='.repeat(78));
console.log();
console.log(`Weights: activeDwell×${W_DWELL_ACTIVE}  copy×${W_COPY}  paste×${W_PASTE}  selEvap×${W_SEL_EVAP}  hub×${W_HUB_PER_CHILD}/child(cap ${W_HUB_CAP})  fallback×${W_FALLBACK}(>${HIGH_DWELL_S}s dwell)`);
console.log();

function fmtScoreParts(p) {
  const parts = [];
  if (p.activeDwell > 0) parts.push(`active=${Math.round(p.activeDwell)}`);
  if (p.copies)          parts.push(`copy×${p.copies}=${W_COPY * p.copies}`);
  if (p.pastes)          parts.push(`paste×${p.pastes}=${W_PASTE * p.pastes}`);
  if (p.selEvap)         parts.push(`selEvap×${p.selEvap}=${W_SEL_EVAP * p.selEvap}`);
  if (p.hub_bonus)       parts.push(`hub=${p.hub_bonus}`);
  if (p.fallback)        parts.push(`fallback=${p.fallback}`);
  return parts.join(' + ');
}

console.log(`Rank  Score   In top-${TOP_K}?  Was labeled?  URL`);
console.log('-'.repeat(78));
for (let i = 0; i < Math.min(scored.length, TOP_K + 4); i++) {
  const r = scored[i];
  const inferred = i < TOP_K ? 'YES' : ' no';
  const labeled  = labeledAnchors.has(r.url) ? 'YES' : ' no';
  const match    = (inferred === 'YES') === (labeled === 'YES') ? '  ' : '⚠ ';
  console.log(`${match}${String(i + 1).padStart(3)}.  ${String(Math.round(r.score.total)).padStart(5)}   ${inferred}          ${labeled}           ${r.url}`);
  console.log(`              ${fmtScoreParts(r.score.parts)}`);
}
console.log();

// Confusion matrix
const matchedInf  = [...inferredAnchors].filter(u => labeledAnchors.has(u));
const missedInf   = [...labeledAnchors].filter(u => !inferredAnchors.has(u));
const extraInf    = [...inferredAnchors].filter(u => !labeledAnchors.has(u));

console.log('--- Inference vs. labeled anchors ---');
console.log(`Matched:  ${matchedInf.length} / ${labeledAnchors.size}`);
if (missedInf.length) {
  console.log(`Missed (labeled but not inferred):`);
  for (const u of missedInf) console.log(`  - ${u}`);
}
if (extraInf.length) {
  console.log(`Extra (inferred but not labeled):`);
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
