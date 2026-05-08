const ANCHOR_TITLE_SIZE_RATIO = 0.30;
const ANCHOR_META_SIZE_RATIO  = 0.19;
const ANCHOR_TITLE_Y_RATIO    = 0.15;
const ANCHOR_META1_Y_RATIO    = 0.20;
const ANCHOR_META2_Y_RATIO    = 0.38;

// Rounded rectangle sizing (width = r * W, height = r * H, corner = r * RX)
const NODE_W_RATIO  = 3.2;
const NODE_H_RATIO  = 1.8;
const NODE_RX_RATIO = 0.25;

// Layout constants — shared by computeAnchorLayout and renderAnchorEdgesAndBg
const LAYOUT_CENTER_X  = 500;
const LAYOUT_COPY_GAP  = 420;
const LAYOUT_TOP_OFFSET  = 240;  // root/slack offset from center

// ── Text measurement ──────────────────────────────────────────────────────────

const NODE_MAX_W    = 220;  // px cap on node width
const NODE_LABEL_H_PAD = 24;  // total horizontal padding inside node

let _measCtx = null;
function _textW(text, fontSize) {
  if (!_measCtx) _measCtx = document.createElement('canvas').getContext('2d');
  _measCtx.font = `400 ${fontSize}px Inter, sans-serif`;
  return _measCtx.measureText(text).width;
}

// Binary-search truncation: returns longest prefix of text that fits in maxPx at fontSize.
function _truncateFit(text, maxPx, fontSize) {
  if (_textW(text, fontSize) <= maxPx) return text;
  let lo = 0, hi = text.length;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (_textW(text.slice(0, mid) + '…', fontSize) <= maxPx) lo = mid; else hi = mid;
  }
  return text.slice(0, lo) + '…';
}

// Compute node width from its text content, clamped to [r*2, NODE_MAX_W].
function _nodeW(r, labelText, metaText, meta2Text) {
  const tSize = r * ANCHOR_TITLE_SIZE_RATIO;
  const mSize = r * ANCHOR_META_SIZE_RATIO;
  const needed = Math.max(
    _textW(labelText,  tSize),
    _textW(metaText,   mSize),
    meta2Text ? _textW(meta2Text, mSize) : 0
  ) + NODE_LABEL_H_PAD;
  return Math.max(r * 2, Math.min(needed, NODE_MAX_W));
}

// Returns { layout, anchorNodeIds, bounds }
function computeAnchorLayout(flat) {
  const { anchors, satellites } = prepareAnchorData(flat);
  if (anchors.length === 0) return { layout: new Map(), anchorNodeIds: new Set(), bounds: null };

  const scores = anchors.map(a => a.score);
  const minS = Math.min(...scores), maxS = Math.max(...scores);
  anchors.forEach(a => { a.r = anchorRadius(a.score, minS, maxS); });

  // Three-row hierarchical layout
  const rootAnchor = anchors.find(a => a.firstIdx === 0);
  const slackAnchor = anchors.find(a => a.totalDwell > 700 && a !== rootAnchor);
  const keepAnchor = anchors.find(a => a.url === 'KEEP');
  const copyAnchors = anchors.filter(a => a !== rootAnchor && a !== slackAnchor && a !== keepAnchor && a.copyCount > 0);

  const topY = 0;
  const middleY = 350;
  const bottomY = 700;
  const centerX = LAYOUT_CENTER_X;
  const copyGap = LAYOUT_COPY_GAP;

  // Row 1: root and slack
  if (rootAnchor) { rootAnchor.cx = centerX - LAYOUT_TOP_OFFSET; rootAnchor.cy = topY; }
  if (slackAnchor) { slackAnchor.cx = centerX + LAYOUT_TOP_OFFSET; slackAnchor.cy = topY; }

  // Row 2: copy nodes (Vado, Trek, Gazelle) centered horizontally
  if (copyAnchors.length > 0) {
    const copyStartX = centerX - (copyAnchors.length - 1) * copyGap / 2;
    copyAnchors.forEach((a, i) => {
      a.cx = copyStartX + i * copyGap;
      a.cy = middleY;
    });
  }

  // Row 3: paste nodes (Keep)
  if (keepAnchor) { keepAnchor.cx = centerX; keepAnchor.cy = bottomY; }

  const buckets = assignSatellitesToAnchors(anchors, satellites, flat);

  // Normalize non-anchor node radii to [12-40]px across all nodes
  const allSats = anchors.flatMap(a => buckets.get(a.url) || []);
  const satScores = allSats.map(nodeScore);
  const minSatS = Math.min(...satScores), maxSatS = Math.max(...satScores);
  allSats.forEach(sat => { sat.r = nodeRadius(nodeScore(sat), minSatS, maxSatS); });

  // Compute node positions around their anchor
  for (const a of anchors) {
    const sats = buckets.get(a.url) || [];
    sats.forEach((sat, i) => {
      const half = i % 2 === 0 ? 'top' : 'bottom';
      const idxInHalf = Math.floor(i / 2);
      const topCount = Math.ceil(sats.length / 2);
      const bottomCount = Math.floor(sats.length / 2);
      const countInHalf = half === 'top' ? topCount : bottomCount;
      let angleStart, angleEnd;
      if (half === 'top') { angleStart = -160 * Math.PI / 180; angleEnd = -20 * Math.PI / 180; }
      else                { angleStart = 20 * Math.PI / 180;   angleEnd = 160 * Math.PI / 180; }
      const t = countInHalf === 1 ? 0.5 : idxInHalf / Math.max(1, countInHalf - 1);
      sat._angle = angleStart + t * (angleEnd - angleStart);
      const ringDist = a.r + SATELLITE_RING;
      sat.cx = a.cx + Math.cos(sat._angle) * ringDist;
      sat.cy = a.cy + Math.sin(sat._angle) * ringDist;
    });
  }

  // Build place map — anchors carry extra display data including computed width
  const placeMap = new Map();
  for (const a of anchors) {
    const dwellMin   = Math.round(a.totalDwell / 60);
    const visitLabel = `${a.visits.length} visit${a.visits.length !== 1 ? 's' : ''} · ${dwellMin}m`;
    const hasPaste   = (a.pastesReceived || 0) > 0, hasCopy = (a.copyCount || 0) > 0;
    const meta2      = hasPaste ? `${a.pastesReceived} pastes` : hasCopy ? `${a.copyCount} copies` : '';
    const rawLabel   = placeLabel(a.url, a.page_title);
    const w          = _nodeW(a.r, rawLabel, visitLabel, meta2);
    placeMap.set(a.url, {
      cx: a.cx, cy: a.cy, r: a.r, isAnchor: true,
      url: a.url, page_title: a.page_title,
      visitCount: a.visits.length, totalDwell: a.totalDwell,
      copyCount: a.copyCount, pasteCount: a.pastesReceived, w,
    });
  }
  for (const a of anchors) {
    for (const sat of (buckets.get(a.url) || [])) {
      placeMap.set(sat.url, {
        cx: sat.cx, cy: sat.cy, r: sat.r, isAnchor: false,
        url: sat.url, page_title: sat.page_title,
        visitCount: sat.visits.length, totalDwell: sat.totalDwell,
        copyCount: sat.copyCount, pasteCount: sat.pastesReceived,
      });
    }
  }

  // Map each node to its place position — anchors and non-anchors render identically
  const layout = new Map();
  const anchorNodeIds = new Set();

  // Precompute anchor positions by firstIdx for collapsing orphan nodes
  const anchorsSortedByIdx = [...anchors].sort((a, b) => a.firstIdx - b.firstIdx);
  function nearestAnchorPos(nodeIdx) {
    let a = anchorsSortedByIdx[0];
    for (const candidate of anchorsSortedByIdx) {
      if (candidate.firstIdx <= nodeIdx) a = candidate;
      else break;
    }
    return { cx: a.cx, cy: a.cy };
  }

  flat.forEach((node, nodeIdx) => {
    const url = normUrl(node.url);
    const place = placeMap.get(url);
    if (!place) {
      // Orphan node: no anchor ancestor. Collapse it invisibly toward the nearest anchor.
      const pos = nearestAnchorPos(nodeIdx);
      layout.set(node.node_id, {
        cx: pos.cx, cy: pos.cy, r: 0, opacity: 0,
        labelText: '', metaText: '', meta2Text: '', circleClass: '',
        labelX: pos.cx, labelY: pos.cy, labelAnchor: 'middle', labelFontSize: 0,
        metaX: pos.cx, metaY: pos.cy, metaFontSize: 0,
        meta2X: pos.cx, meta2Y: pos.cy,
      });
      return;
    }

    // Color determined at place level so all visits to same URL share one class
    const placeHasPaste = (place.pasteCount || 0) > 0;
    const placeHasCopy  = (place.copyCount  || 0) > 0;
    const colorClass = placeHasPaste ? ' paste' : placeHasCopy ? ' copy' : '';

    const dwellMin   = Math.round(place.totalDwell / 60);
    const meta2Text  = placeHasPaste
      ? `${place.pasteCount} pastes`
      : placeHasCopy ? `${place.copyCount} copies` : '';
    const visitLabel = `${place.visitCount} visit${place.visitCount !== 1 ? 's' : ''} · ${dwellMin}m`;

    const isAnchor  = place.isAnchor;
    const nodeW     = isAnchor ? (place.w ?? place.r * NODE_W_RATIO) : place.r * NODE_W_RATIO;
    const rawLabel  = placeLabel(place.url, place.page_title);
    const labelText = isAnchor
      ? _truncateFit(rawLabel, nodeW - NODE_LABEL_H_PAD, place.r * ANCHOR_TITLE_SIZE_RATIO)
      : '';

    layout.set(node.node_id, {
      cx: place.cx, cy: place.cy, r: place.r, opacity: isAnchor ? 1 : 0, w: nodeW,
      labelX: place.cx,
      labelY: place.cy - place.r * ANCHOR_TITLE_Y_RATIO,
      labelAnchor: 'middle',
      labelFontSize: isAnchor ? place.r * ANCHOR_TITLE_SIZE_RATIO : 0,
      labelBaseline: 'central',
      labelText,
      circleClass: (isAnchor ? 'anchor' : '') + colorClass,
      metaText: isAnchor ? visitLabel : '',
      metaX: place.cx,
      metaY: place.cy + place.r * ANCHOR_META1_Y_RATIO,
      metaFontSize: isAnchor ? place.r * ANCHOR_META_SIZE_RATIO : 0,
      meta2Text: isAnchor ? meta2Text : '',
      meta2X: place.cx,
      meta2Y: place.cy + place.r * ANCHOR_META2_Y_RATIO,
    });

    if (place.isAnchor) anchorNodeIds.add(node.node_id);
  });

  const allX = anchors.flatMap(a => [a.cx - a.r - SATELLITE_RING, a.cx + a.r + SATELLITE_RING]);
  const allY = anchors.flatMap(a => [a.cy - a.r - SATELLITE_RING, a.cy + a.r + SATELLITE_RING]);
  const bounds = {
    minX: Math.min(...allX) - PAD,
    maxX: Math.max(...allX) + PAD,
    minY: Math.min(...allY) - PAD - 40,
    maxY: Math.max(...allY) + PAD + 20,
  };

  return { anchors, buckets, layout, anchorNodeIds, bounds };
}

// Physics-based settlement: run one simulation per row so satellites from
// adjacent anchors in the same row resolve collisions with each other,
// but nodes in different rows never interact.
function settleAnchorPhysics(flat, anchors, currentLayout) {
  const rootAnchor  = anchors.find(a => a.firstIdx === 0);
  const slackAnchor = anchors.find(a => a.totalDwell > 700 && a !== rootAnchor);
  const keepAnchor  = anchors.find(a => a.url === 'KEEP');
  const copyAnchors = anchors.filter(a => a !== rootAnchor && a !== slackAnchor && a !== keepAnchor && a.copyCount > 0);

  const rows = [
    [rootAnchor, slackAnchor].filter(Boolean),
    copyAnchors,
    [keepAnchor].filter(Boolean),
  ];

  const buckets = assignSatellitesToAnchors(anchors, prepareAnchorData(flat).satellites, flat);
  const settledLayout = new Map(currentLayout);

  const MAX_DRIFT = 60;

  for (const rowAnchors of rows) {
    if (rowAnchors.length === 0) continue;

    // Collect all nodes in this row: anchors (fixed) + all their satellites
    const rowNodes = [];

    for (const a of rowAnchors) {
      const anchorPos = currentLayout.get(a.visits[0]?.node_id);
      if (!anchorPos) continue;
      rowNodes.push({ id: `__anchor_${a.url}__`, x: anchorPos.cx, y: anchorPos.cy, r: a.r, fx: anchorPos.cx, fy: anchorPos.cy });

      for (const sat of (buckets.get(a.url) || [])) {
        const nodeId = sat.visits[0]?.node_id;
        const pos = nodeId ? currentLayout.get(nodeId) : null;
        if (!pos || pos.opacity === 0) continue;
        rowNodes.push({ id: nodeId, x: pos.cx, y: pos.cy, ox: pos.cx, oy: pos.cy, r: pos.r ?? 8 });
      }
    }

    if (rowNodes.length < 2) continue;

    const simulation = d3.forceSimulation(rowNodes)
      .force('collide', d3.forceCollide(d => d.r + 6).strength(0.9).iterations(4))
      .force('x', d3.forceX(d => d.ox ?? d.x).strength(0.8))
      .force('y', d3.forceY(d => d.oy ?? d.y).strength(0.8))
      .alphaDecay(0.05)
      .stop();

    for (let i = 0; i < 40; i++) {
      simulation.tick();
      rowNodes.forEach(n => {
        if (n.fx !== null) return;
        const dx = n.x - n.ox, dy = n.y - n.oy;
        const dist = Math.hypot(dx, dy);
        if (dist > MAX_DRIFT) {
          n.x = n.ox + (dx / dist) * MAX_DRIFT;
          n.y = n.oy + (dy / dist) * MAX_DRIFT;
        }
      });
    }

    rowNodes.forEach(n => {
      if (n.id.startsWith('__anchor_')) return;
      const existing = settledLayout.get(n.id);
      if (existing) settledLayout.set(n.id, { ...existing, cx: n.x, cy: n.y });
    });
  }

  return settledLayout;
}

// Returns the point on the visible border of a rounded rect (centered at cx,cy) in
// direction `angle`. buffer > 0 moves the point outward past the border by that many
// SVG units — use this to float arrowheads just outside the node.
function rectEdgePoint(cx, cy, r, angle, buffer = 0, hwOverride = null) {
  const hw = hwOverride !== null ? hwOverride : r * NODE_W_RATIO / 2;
  const hh = r * NODE_H_RATIO / 2;
  const rx = r * NODE_RX_RATIO;
  const cos = Math.cos(angle), sin = Math.sin(angle);

  // Time to hit each straight edge from the center
  const tx = Math.abs(cos) > 1e-9 ? hw / Math.abs(cos) : Infinity;
  const ty = Math.abs(sin) > 1e-9 ? hh / Math.abs(sin) : Infinity;
  const t  = Math.min(tx, ty);
  const px = cos * t, py = sin * t;

  let borderT;
  if (Math.abs(px) > hw - rx + 0.001 && Math.abs(py) > hh - rx + 0.001) {
    // Ray lands in a corner region — intersect with the corner arc circle instead
    const ccx = Math.sign(cos) * (hw - rx);
    const ccy = Math.sign(sin) * (hh - rx);
    const dot  = cos * ccx + sin * ccy;
    const disc = dot * dot - (ccx * ccx + ccy * ccy - rx * rx);
    borderT = dot + Math.sqrt(Math.max(0, disc));
  } else {
    borderT = t;
  }

  return { x: cx + cos * (borderT + buffer), y: cy + sin * (borderT + buffer) };
}

function renderAnchorEdgesAndBg(flat) {
  const { anchors } = prepareAnchorData(flat);
  if (anchors.length === 0) return;

  const scores = anchors.map(a => a.score);
  const minS = Math.min(...scores), maxS = Math.max(...scores);
  anchors.forEach(a => { a.r = anchorRadius(a.score, minS, maxS); });

  // Match layout positioning from computeAnchorLayout
  const rootAnchor = anchors.find(a => a.firstIdx === 0);
  const slackAnchor = anchors.find(a => a.totalDwell > 700 && a !== rootAnchor);
  const keepAnchor = anchors.find(a => a.url === 'KEEP');
  const copyAnchors = anchors.filter(a => a !== rootAnchor && a !== slackAnchor && a !== keepAnchor && a.copyCount > 0);

  const topY = 0;
  const middleY = 350;
  const bottomY = 700;
  const centerX = LAYOUT_CENTER_X;
  const copyGap = LAYOUT_COPY_GAP;

  if (rootAnchor) { rootAnchor.cx = centerX - LAYOUT_TOP_OFFSET; rootAnchor.cy = topY; }
  if (slackAnchor) { slackAnchor.cx = centerX + LAYOUT_TOP_OFFSET; slackAnchor.cy = topY; }
  if (copyAnchors.length > 0) {
    const copyStartX = centerX - (copyAnchors.length - 1) * copyGap / 2;
    copyAnchors.forEach((a, i) => {
      a.cx = copyStartX + i * copyGap;
      a.cy = middleY;
    });
  }
  if (keepAnchor) { keepAnchor.cx = centerX; keepAnchor.cy = bottomY; }

  const bgLayer = document.getElementById('bg-layer');
  const edgesG = document.getElementById('edges');
  bgLayer.innerHTML = '';
  edgesG.innerHTML = '';

  // Anchor-to-anchor edges
  const anchorUrls = new Set(anchors.map(a => a.url));
  const transitions = computeAnchorEdges(flat, anchorUrls);
  const anchorByUrl = new Map(anchors.map(a => [a.url, a]));
  // Get computed hw for each anchor from currentPositions (set during layout)
  for (const a of anchors) {
    const pos = currentPositions.get(a.visits[0]?.node_id);
    a.hw = pos?.w ? pos.w / 2 : a.r * NODE_W_RATIO / 2;
  }
  for (const [key, rec] of transitions) {
    const [fromUrl, toUrl] = key.split('||');
    const from = anchorByUrl.get(fromUrl), to = anchorByUrl.get(toUrl);
    if (!from || !to) continue;
    const ARROW_BUFFER = 2;  // px outside border where arrowhead tip sits
    const fromAngle = Math.atan2(to.cy - from.cy, to.cx - from.cx);
    const toAngle = fromAngle + Math.PI;
    const p0 = rectEdgePoint(from.cx, from.cy, from.r, fromAngle, 0, from.hw);
    const p1 = rectEdgePoint(to.cx, to.cy, to.r, toAngle, ARROW_BUFFER, to.hw);
    const isCarrier = rec.carrierCount > 0;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'anchor-edge' + (isCarrier ? ' carrier' : ''));
    path.setAttribute('d', `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`);
    path.setAttribute('stroke-width', Math.min(6, 1 + rec.count * 0.8));
    path.setAttribute('marker-end', `url(#arrowhead-${isCarrier ? 'carrier' : 'accent'})`);
    edgesG.appendChild(path);
  }

}

// ── Satellite hover animation ─────────────────────────────────────────────────

let _hoverRafHandle = null;
let _hoverElements  = [];        // [{sat, rect, label, meta, line}]
let _hoverLivePos   = new Map(); // satUrl → {cx, cy}, updated each animation frame

function _cancelHover() {
  if (_hoverRafHandle) { cancelAnimationFrame(_hoverRafHandle); _hoverRafHandle = null; }
}

// Edge directions touching each anchor — used for cone-based avoidance in hover settle.
// Returns [{fromUrl, toUrl, nx, ny}] where (nx, ny) is the unit vector from→to.
function _hoverEdgeData(anchors, flat) {
  const anchorUrls = new Set(anchors.map(a => a.url));
  const transitions = computeAnchorEdges(flat, anchorUrls);
  const byUrl = new Map(anchors.map(a => [a.url, a]));
  const edges = [];
  for (const [key] of transitions) {
    const [fu, tu] = key.split('||');
    const from = byUrl.get(fu), to = byUrl.get(tu);
    if (!from || !to) continue;
    const len = Math.hypot(to.cx - from.cx, to.cy - from.cy) || 1;
    edges.push({ fromUrl: fu, toUrl: tu,
                 nx: (to.cx - from.cx) / len, ny: (to.cy - from.cy) / len });
  }
  return edges;
}

// Run D3 to steady state; returns Map<satUrl → {cx, cy}>.
// anchorW and satWidths supply computed node widths for accurate collision radii.
function _hoverSettle(anchorPos, anchorW, anchorUrl, sats, allEdgeData, satWidths) {
  const acx = anchorPos.cx, acy = anchorPos.cy;
  const anchorHW = anchorW / 2 + 14;

  // Directions FROM this anchor toward each connected anchor (both incoming and outgoing edges)
  const edgeDirs = allEdgeData
    .filter(e => e.fromUrl === anchorUrl || e.toUrl === anchorUrl)
    .map(e => e.fromUrl === anchorUrl
      ? { nx:  e.nx, ny:  e.ny }   // outgoing: direction toward other anchor
      : { nx: -e.nx, ny: -e.ny }); // incoming: direction back toward source

  const nodes = sats.map((sat, i) => {
    const sw  = satWidths?.get(sat.url) ?? sat.r * NODE_W_RATIO;
    const hw  = sw / 2;
    const angle  = (i / sats.length) * 2 * Math.PI;
    const startR = anchorHW + hw + 10;
    return { url: sat.url, x: acx + Math.cos(angle) * startR, y: acy + Math.sin(angle) * startR,
             hw, vx: 0, vy: 0 };
  });

  function forceAnchorClear(alpha) {
    for (const n of nodes) {
      const dx = n.x - acx, dy = n.y - acy;
      const d = Math.hypot(dx, dy) || 1;
      const min = anchorHW + n.hw + 6;
      if (d < min) { const f = (min - d) / d * alpha; n.vx += dx * f; n.vy += dy * f; }
    }
  }

  // Cone exclusion: satellites within ±CONE_ANGLE of an edge direction get pushed
  // perpendicular to that edge. Using a direction-based dot-product means this never
  // produces a zero force vector, even when the satellite is exactly on the edge axis.
  const CONE = Math.PI / 9; // 20°

  function forceEdgeCone(alpha) {
    for (const n of nodes) {
      const dx = n.x - acx, dy = n.y - acy;
      const dist = Math.hypot(dx, dy) || 1;
      const satNx = dx / dist, satNy = dy / dist;

      for (const dir of edgeDirs) {
        const dot = satNx * dir.nx + satNy * dir.ny;
        if (dot <= 0) continue; // satellite is behind this edge direction

        const angFromEdge = Math.acos(Math.min(1, dot));
        if (angFromEdge >= CONE) continue;

        // cross > 0: satellite is CCW of edge direction; < 0: CW; = 0: exactly on axis
        const cross = satNx * dir.ny - satNy * dir.nx;
        // Push satellite to whichever side it's already on, or CCW when exactly on axis
        const side = cross >= 0 ? -1 : 1;
        const perpNx = -dir.ny * side;
        const perpNy =  dir.nx * side;

        const overlap = (CONE - angFromEdge) / CONE;
        const f = overlap * alpha * 0.6;
        n.vx += perpNx * f * (n.hw + 20);
        n.vy += perpNy * f * (n.hw + 20);
      }
    }
  }

  const avgSatHW = nodes.length ? nodes.reduce((s, n) => s + n.hw, 0) / nodes.length : anchorHW;
  const targetR  = anchorHW + avgSatHW + 30;

  const sim = d3.forceSimulation(nodes)
    .force('collide', d3.forceCollide(d => d.hw + 8).strength(0.9).iterations(4))
    .force('radial',  d3.forceRadial(targetR, acx, acy).strength(0.4))
    .force('anchorClear', forceAnchorClear)
    .force('edgeCone', forceEdgeCone)
    .alphaDecay(0.04)
    .stop();

  for (let i = 0; i < 150; i++) sim.tick();

  const settled = new Map();
  for (const n of nodes) settled.set(n.url, { cx: n.x, cy: n.y });
  return settled;
}

// ── Anchor hover: show/hide satellite cluster on demand ───────────────────────

function setupAnchorHover(flat, anchors, buckets) {
  teardownAnchorHover();

  const overlay  = document.getElementById('satellite-overlay');
  const targetsG = document.getElementById('hover-targets');
  const allEdgeData = _hoverEdgeData(anchors, flat);

  const APPEAR_MS    = 400;
  const DISAPPEAR_MS = 250;

  for (const a of anchors) {
    const anchorPos = currentPositions.get(a.visits[0]?.node_id);
    if (!anchorPos) continue;

    const sats = buckets.get(a.url) || [];

    const hitW = (currentPositions.get(a.visits[0]?.node_id)?.w ?? anchorPos.r * NODE_W_RATIO);
    const h = anchorPos.r * NODE_H_RATIO;
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hit.setAttribute('x', anchorPos.cx - hitW / 2);  hit.setAttribute('y', anchorPos.cy - h / 2);
    hit.setAttribute('width', hitW);                  hit.setAttribute('height', h);
    hit.setAttribute('rx', anchorPos.r * NODE_RX_RATIO);
    hit.setAttribute('fill', 'transparent');        hit.setAttribute('stroke', 'none');
    hit.style.cursor = 'pointer';

    hit.addEventListener('mouseenter', () => {
      _cancelHover();
      overlay.innerHTML = '';
      _hoverElements = [];
      _hoverLivePos  = new Map();
      if (!sats.length) return;

      // Pre-compute per-satellite widths and pixel-truncated labels
      const satInfo = new Map();
      for (const sat of sats) {
        const sr       = sat.r;
        const rawLabel = placeLabel(sat.url, sat.page_title);
        const dwellMin = Math.round(sat.totalDwell / 60);
        const metaText = `${sat.visits.length} visit${sat.visits.length !== 1 ? 's' : ''} · ${dwellMin}m`;
        const sw       = _nodeW(sr, rawLabel, metaText, '');
        const labelText = _truncateFit(rawLabel, sw - NODE_LABEL_H_PAD, sr * ANCHOR_TITLE_SIZE_RATIO);
        satInfo.set(sat.url, { sw, labelText, metaText });
      }
      const satWidths = new Map([...satInfo].map(([url, { sw }]) => [url, sw]));

      const anchorNodePos = currentPositions.get(a.visits[0]?.node_id);
      const anchorW = anchorNodePos?.w ?? anchorPos.r * NODE_W_RATIO;
      const settled = _hoverSettle(anchorPos, anchorW, a.url, sats, allEdgeData, satWidths);
      const acx = anchorPos.cx, acy = anchorPos.cy;

      // Lines first (behind rects)
      for (const sat of sats) {
        if (!settled.has(sat.url)) continue;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'satellite-link');
        overlay.appendChild(line);
        _hoverElements.push({ sat, line, rect: null, label: null, meta: null, sw: satInfo.get(sat.url)?.sw ?? sat.r * NODE_W_RATIO });
      }
      // Rects + labels on top
      for (let i = 0; i < _hoverElements.length; i++) {
        const { sat, sw } = _hoverElements[i];
        const sr = sat.r, sh = sr * NODE_H_RATIO;
        const cc = (sat.pastesReceived > 0) ? ' paste' : (sat.copyCount > 0) ? ' copy' : '';
        const { labelText, metaText } = satInfo.get(sat.url) || {};

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'node' + cc);
        rect.setAttribute('width', sw); rect.setAttribute('height', sh);
        rect.setAttribute('rx', sr * NODE_RX_RATIO);
        overlay.appendChild(rect);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('class', 'node-label');
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'central');
        label.setAttribute('font-size', sr * ANCHOR_TITLE_SIZE_RATIO);
        label.textContent = labelText ?? '';
        overlay.appendChild(label);

        const meta = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        meta.setAttribute('class', 'node-meta');
        meta.setAttribute('text-anchor', 'middle');
        meta.setAttribute('font-size', sr * ANCHOR_META_SIZE_RATIO);
        meta.textContent = metaText ?? '';
        overlay.appendChild(meta);

        _hoverElements[i] = { ..._hoverElements[i], rect, label, meta };
      }

      // Appear: lerp from anchor center → settled positions
      let t0 = null;
      function appearTick(now) {
        if (!t0) t0 = now;
        const t  = Math.min((now - t0) / APPEAR_MS, 1);
        const et = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;

        for (const { sat, rect, label, meta, line, sw } of _hoverElements) {
          const tgt = settled.get(sat.url);
          if (!tgt || !rect) continue;
          const cx = _lerp(acx, tgt.cx, et), cy = _lerp(acy, tgt.cy, et);
          const op = et;
          const sr = sat.r, sh = sr * NODE_H_RATIO;

          rect.setAttribute('x', cx - sw / 2); rect.setAttribute('y', cy - sh / 2);
          rect.setAttribute('opacity', op);
          label.setAttribute('x', cx); label.setAttribute('y', cy - sr * ANCHOR_TITLE_Y_RATIO);
          label.setAttribute('opacity', op);
          meta.setAttribute('x', cx);  meta.setAttribute('y', cy + sr * ANCHOR_META1_Y_RATIO);
          meta.setAttribute('opacity', op);

          const ang = Math.atan2(cy - acy, cx - acx);
          const p0  = rectEdgePoint(acx, acy, anchorPos.r, ang, 0, anchorW / 2);
          const p1  = rectEdgePoint(cx,  cy,  sr,          ang + Math.PI, 0, sw / 2);
          line.setAttribute('x1', p0.x); line.setAttribute('y1', p0.y);
          line.setAttribute('x2', p1.x); line.setAttribute('y2', p1.y);
          line.setAttribute('opacity', op * 0.7);

          _hoverLivePos.set(sat.url, { cx, cy });
        }
        _hoverRafHandle = t < 1 ? requestAnimationFrame(appearTick) : null;
      }
      _hoverRafHandle = requestAnimationFrame(appearTick);
    });

    hit.addEventListener('mouseleave', () => {
      _cancelHover();
      const fromPos  = new Map(_hoverLivePos);
      const elemSnap = [..._hoverElements];
      _hoverLivePos  = new Map();
      if (!elemSnap.length) { overlay.innerHTML = ''; return; }

      const acx = anchorPos.cx, acy = anchorPos.cy;
      let t0 = null;

      function disappearTick(now) {
        if (!t0) t0 = now;
        const t  = Math.min((now - t0) / DISAPPEAR_MS, 1);
        const et = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
        const op = 1 - et;

        for (const { sat, rect, label, meta, line, sw } of elemSnap) {
          if (!rect) continue;
          const from = fromPos.get(sat.url) || { cx: acx, cy: acy };
          const cx = _lerp(from.cx, acx, et), cy = _lerp(from.cy, acy, et);
          const sr = sat.r, sh = sr * NODE_H_RATIO;

          rect.setAttribute('x', cx - sw / 2); rect.setAttribute('y', cy - sh / 2);
          rect.setAttribute('opacity', op);
          label.setAttribute('x', cx); label.setAttribute('y', cy - sr * ANCHOR_TITLE_Y_RATIO);
          label.setAttribute('opacity', op);
          meta.setAttribute('x', cx);  meta.setAttribute('y', cy + sr * ANCHOR_META1_Y_RATIO);
          meta.setAttribute('opacity', op);

          const ang = Math.atan2(cy - acy, cx - acx);
          const p0  = rectEdgePoint(acx, acy, anchorPos.r, ang, 0, anchorW / 2);
          const p1  = rectEdgePoint(cx,  cy,  sr,          ang + Math.PI, 0, sw / 2);
          line.setAttribute('x1', p0.x); line.setAttribute('y1', p0.y);
          line.setAttribute('x2', p1.x); line.setAttribute('y2', p1.y);
          line.setAttribute('opacity', op * 0.7);
        }

        if (t < 1) {
          _hoverRafHandle = requestAnimationFrame(disappearTick);
        } else {
          overlay.innerHTML = '';
          _hoverElements = [];
          _hoverRafHandle = null;
        }
      }
      _hoverRafHandle = requestAnimationFrame(disappearTick);
    });

    targetsG.appendChild(hit);
  }
}

function teardownAnchorHover() {
  _cancelHover();
  const overlay = document.getElementById('satellite-overlay');
  const targetsG = document.getElementById('hover-targets');
  if (overlay) overlay.innerHTML = '';
  if (targetsG) targetsG.innerHTML = '';
  _hoverElements = [];
  _hoverLivePos  = new Map();
}

