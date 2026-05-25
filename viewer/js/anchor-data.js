const ANCHOR_BAND_Y = 0;
const ANCHOR_GAP_X = 280;
const VERTICAL_RANGE = 220;
const SATELLITE_RING = 95;
const MIN_ANCHOR_LABEL_PX = 60;
const MIN_ANCHOR_META_PX = 80;

// Anchor-inference weights — see scripts/test-anchor-equivalence.js for the
// tuning process. Tuned so the inferred anchor set matches the labeled set
// exactly on the current dataset, with a wide margin (rank-6 = 376, rank-7 = 122).
const ANCHOR_W_DWELL_ACTIVE = 0.3;
const ANCHOR_W_COPY         = 150;
const ANCHOR_W_PASTE        = 80;
const ANCHOR_W_HUB_PER_CHILD = 120;
const ANCHOR_W_HUB_CAP      = 5;
const ANCHOR_W_FALLBACK     = 250;
const ANCHOR_HIGH_DWELL_S   = 700;
const ANCHOR_SCORE_THRESHOLD = 200;  // boundary is wide; any value 150-300 works

function prepareAnchorData(flat) {
  // Count children per node_id to identify hub nodes
  const childCount = new Map();
  flat.forEach(n => {
    if (n.parent_node_id)
      childCount.set(n.parent_node_id, (childCount.get(n.parent_node_id) || 0) + 1);
  });

  const byUrl = new Map();
  flat.forEach((node, idx) => {
    const url = normUrl(node.url);
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        url,
        page_title: node.page_title,
        visits: [],
        visitIndices: [],
        totalDwell: 0,
        maxDwell: 0,
        maxScroll: 0,
        maxChildren: 0,
        copyCount: 0,
        pastesReceived: 0,
        isAnchored: false,
        firstIdx: idx,
        hasCopy: false,
      });
    }
    const place = byUrl.get(url);
    place.visits.push(node);
    place.visitIndices.push(idx);
    place.totalDwell += node.active_signals.dwell_time_seconds;
    place.maxDwell    = Math.max(place.maxDwell, node.active_signals.dwell_time_seconds);
    place.maxScroll   = Math.max(place.maxScroll, node.active_signals.max_scroll_depth_percent ?? 0);
    place.maxChildren = Math.max(place.maxChildren, childCount.get(node.node_id) || 0);
    if (node.active_signals.clipboard_event === 'copy') {
      place.copyCount++;
      place.hasCopy = true;
    } else if (node.active_signals.clipboard_event === 'paste') {
      place.pastesReceived++;
    }
  });

  // ---- inferred anchors ----
  // Multi-signal scoring. Each place earns points from: active dwell
  // (gated by scroll), copies, pastes received, hub structure (transitive
  // descendant count — see below), and a fallback for under-instrumented
  // sources (apps with no scroll/copy signal).
  // Weights tuned in scripts/test-anchor-equivalence.js.
  function _scorePlace(place, hubInput) {
    const activeDwell = place.maxDwell * (place.maxScroll / 100);
    const hubBonus    = Math.min(ANCHOR_W_HUB_CAP, Math.max(0, hubInput - 2)) * ANCHOR_W_HUB_PER_CHILD;
    const fallback    = (place.maxDwell > ANCHOR_HIGH_DWELL_S) ? ANCHOR_W_FALLBACK : 0;
    return ANCHOR_W_DWELL_ACTIVE * activeDwell
         + ANCHOR_W_COPY         * place.copyCount
         + ANCHOR_W_PASTE        * place.pastesReceived
         + hubBonus + fallback;
  }

  // First pass: score with direct-child count to determine the anchor set
  for (const place of byUrl.values()) {
    place.anchorScore = _scorePlace(place, place.maxChildren);
    place.isAnchored  = place.anchorScore >= ANCHOR_SCORE_THRESHOLD;
  }

  // Compute bucket size per anchor — number of non-anchor places whose
  // nearest anchor ancestor is this one. Bigger gravitational clusters
  // (Google Search has 13 descendants) get a stronger hub bonus.
  const anchorUrlsByPlace = new Set([...byUrl.values()].filter(p => p.isAnchored).map(p => p.url));
  const nodeByIdLocal = new Map(flat.map(n => [n.node_id, n]));
  const bucketSize = new Map();
  for (const u of anchorUrlsByPlace) bucketSize.set(u, 0);
  for (const place of byUrl.values()) {
    if (place.isAnchored) continue;
    let anchorUrl = null;
    outer:
    for (const idx of place.visitIndices) {
      let cur = flat[idx].parent_node_id ? nodeByIdLocal.get(flat[idx].parent_node_id) : null;
      while (cur) {
        const u = normUrl(cur.url);
        if (anchorUrlsByPlace.has(u)) { anchorUrl = u; break outer; }
        cur = cur.parent_node_id ? nodeByIdLocal.get(cur.parent_node_id) : null;
      }
    }
    if (anchorUrl) bucketSize.set(anchorUrl, bucketSize.get(anchorUrl) + 1);
  }

  // Second pass: re-score anchors using bucketSize for the hub input.
  // Non-anchors keep their direct-child score (which kept them out of the set).
  for (const place of byUrl.values()) {
    if (!place.isAnchored) continue;
    const hubInput = Math.max(place.maxChildren, bucketSize.get(place.url) || 0);
    place.anchorScore = _scorePlace(place, hubInput);
  }

  const anchors = [];
  const satellites = [];
  for (const place of byUrl.values()) {
    if (place.isAnchored) anchors.push(place);
    else satellites.push(place);
  }
  anchors.sort((a, b) => a.firstIdx - b.firstIdx);

  // Anchor radius uses the same multi-signal score as the inference decision,
  // so a place that barely passes the threshold also looks visually small.
  anchors.forEach(a => { a.score = a.anchorScore; });

  // center of mass for vertical positioning
  const total = flat.length;
  anchors.forEach(a => {
    const sum = a.visitIndices.reduce((s, i) => s + i, 0);
    a.centerOfMass = sum / a.visitIndices.length / total;
  });

  return { anchors, satellites };
}

function anchorRadius(score, minScore, maxScore) {
  const minR = 28, maxR = 64;
  if (maxScore === minScore) return (minR + maxR) / 2;
  const t = (score - minScore) / (maxScore - minScore);
  return minR + Math.sqrt(t) * (maxR - minR);
}

function nodeRadius(score, minScore, maxScore) {
  const minR = 12, maxR = 40;
  if (maxScore === minScore) return (minR + maxR) / 2;
  const t = (score - minScore) / (maxScore - minScore);
  return minR + Math.sqrt(t) * (maxR - minR);
}

function nodeScore(place) {
  return Math.pow(place.totalDwell, 0.8) + 12 * (place.copyCount || 0) + 8 * (place.pastesReceived || 0);
}


function assignSatellitesToAnchors(anchors, satellites, flat) {
  const buckets = new Map(anchors.map(a => [a.url, []]));
  const anchorByUrl = new Map(anchors.map(a => [a.url, a]));

  if (flat) {
    const nodeById = new Map(flat.map(n => [n.node_id, n]));

    for (const sat of satellites) {
      let chosen = null;

      // Walk the full ancestor chain of each visit to find the nearest anchor ancestor
      outer:
      for (const idx of sat.visitIndices) {
        let cur = flat[idx].parent_node_id ? nodeById.get(flat[idx].parent_node_id) : null;
        while (cur) {
          const url = normUrl(cur.url);
          if (anchorByUrl.has(url)) { chosen = anchorByUrl.get(url); break outer; }
          cur = cur.parent_node_id ? nodeById.get(cur.parent_node_id) : null;
        }
      }

      if (chosen) buckets.get(chosen.url).push(sat);
      // If no anchor ancestor found, sat is an orphan and excluded from the view
    }

    // Tag satellites whose visits have a child node pointing to an anchor
    for (const sat of satellites) {
      for (const visit of sat.visits) {
        for (const node of flat) {
          if (node.parent_node_id !== visit.node_id) continue;
          const childUrl = normUrl(node.url);
          if (anchorByUrl.has(childUrl) && childUrl !== normUrl(visit.url)) {
            sat.destinationAnchor = anchorByUrl.get(childUrl);
            break;
          }
        }
        if (sat.destinationAnchor) break;
      }
    }
  } else {
    // Fallback: chronological
    for (const sat of satellites) {
      let chosen = anchors[0];
      for (const a of anchors) {
        if (a.firstIdx <= sat.firstIdx) chosen = a;
        else break;
      }
      buckets.get(chosen.url).push(sat);
    }
  }
  return buckets;
}

function computeAnchorEdges(flat, anchorUrls) {
  const edges = new Map();
  const byId = new Map(flat.map(n => [n.node_id, n]));
  for (const node of flat) {
    if (!node.parent_node_id) continue;
    const parent = byId.get(node.parent_node_id);
    if (!parent) continue;
    const pUrl = normUrl(parent.url);
    const cUrl = normUrl(node.url);
    if (!anchorUrls.has(pUrl) || !anchorUrls.has(cUrl)) continue;
    if (pUrl === cUrl) continue;
    const key = pUrl + '||' + cUrl;
    if (!edges.has(key)) edges.set(key, { count: 0, carrierCount: 0 });
    const rec = edges.get(key);
    rec.count++;
    if (parent.active_signals.clipboard_event === 'copy') rec.carrierCount++;
  }
  return edges;
}

