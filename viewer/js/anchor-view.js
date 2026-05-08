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

  // Build place map — anchors carry extra display data
  const placeMap = new Map();
  for (const a of anchors) {
    placeMap.set(a.url, {
      cx: a.cx, cy: a.cy, r: a.r, isAnchor: true,
      url: a.url, page_title: a.page_title,
      visitCount: a.visits.length,
      totalDwell: a.totalDwell,
      copyCount: a.copyCount,
      pasteCount: a.pastesReceived,
    });
  }
  for (const a of anchors) {
    for (const sat of (buckets.get(a.url) || [])) {
      placeMap.set(sat.url, {
        cx: sat.cx, cy: sat.cy, r: sat.r, isAnchor: false,
        url: sat.url, page_title: sat.page_title,
        visitCount: sat.visits.length,
        totalDwell: sat.totalDwell,
        copyCount: sat.copyCount,
        pasteCount: sat.pastesReceived,
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

    const dwellMin = Math.round(place.totalDwell / 60);
    const meta2Text = placeHasPaste
      ? `${place.pasteCount} pastes`
      : placeHasCopy ? `${place.copyCount} copies` : '';
    const visitLabel = `${place.visitCount} visit${place.visitCount !== 1 ? 's' : ''} · ${dwellMin}m`;

    const isAnchor = place.isAnchor;
    layout.set(node.node_id, {
      cx: place.cx, cy: place.cy, r: place.r, opacity: isAnchor ? 1 : 0,
      labelX: place.cx,
      labelY: place.cy - place.r * ANCHOR_TITLE_Y_RATIO,
      labelAnchor: 'middle',
      labelFontSize: isAnchor ? place.r * ANCHOR_TITLE_SIZE_RATIO : 0,
      labelBaseline: 'central',
      labelText: isAnchor ? truncate(placeLabel(place.url, place.page_title), 20) : '',
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
function rectEdgePoint(cx, cy, r, angle, buffer = 0) {
  const hw = r * NODE_W_RATIO / 2;
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
  for (const [key, rec] of transitions) {
    const [fromUrl, toUrl] = key.split('||');
    const from = anchorByUrl.get(fromUrl), to = anchorByUrl.get(toUrl);
    if (!from || !to) continue;
    const ARROW_BUFFER = 2;  // px outside border where arrowhead tip sits
    const fromAngle = Math.atan2(to.cy - from.cy, to.cx - from.cx);
    const toAngle = fromAngle + Math.PI;
    const p0 = rectEdgePoint(from.cx, from.cy, from.r, fromAngle);
    const p1 = rectEdgePoint(to.cx, to.cy, to.r, toAngle, ARROW_BUFFER);
    const isCarrier = rec.carrierCount > 0;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'anchor-edge' + (isCarrier ? ' carrier' : ''));
    path.setAttribute('d', `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y}`);
    path.setAttribute('stroke-width', Math.min(6, 1 + rec.count * 0.8));
    path.setAttribute('marker-end', `url(#arrowhead-${isCarrier ? 'carrier' : 'accent'})`);
    edgesG.appendChild(path);
  }

}

// ── Anchor hover: show/hide satellite cluster on demand ───────────────────────

function setupAnchorHover(flat, anchors, buckets) {
  teardownAnchorHover();

  const overlay  = document.getElementById('satellite-overlay');
  const targetsG = document.getElementById('hover-targets');
  const anchorByUrl = new Map(anchors.map(a => [a.url, a]));

  for (const a of anchors) {
    const anchorPos = currentPositions.get(a.visits[0]?.node_id);
    if (!anchorPos) continue;

    const w = anchorPos.r * NODE_W_RATIO, h = anchorPos.r * NODE_H_RATIO;
    const target = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    target.setAttribute('x', anchorPos.cx - w / 2);
    target.setAttribute('y', anchorPos.cy - h / 2);
    target.setAttribute('width', w);
    target.setAttribute('height', h);
    target.setAttribute('rx', anchorPos.r * NODE_RX_RATIO);
    target.setAttribute('fill', 'transparent');
    target.setAttribute('stroke', 'none');
    target.style.cursor = 'pointer';

    const sats = buckets.get(a.url) || [];

    target.addEventListener('mouseenter', () => {
      overlay.innerHTML = '';

      // Draw lines first so they appear behind node rects
      for (const sat of sats) {
        const pos = currentPositions.get(sat.visits[0]?.node_id);
        if (!pos) continue;
        const angle = Math.atan2(pos.cy - anchorPos.cy, pos.cx - anchorPos.cx);
        const p0 = rectEdgePoint(anchorPos.cx, anchorPos.cy, anchorPos.r, angle);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'satellite-link');
        line.setAttribute('x1', p0.x); line.setAttribute('y1', p0.y);
        line.setAttribute('x2', pos.cx); line.setAttribute('y2', pos.cy);
        overlay.appendChild(line);
      }

      // Draw satellite nodes on top of lines
      for (const sat of sats) {
        const pos = currentPositions.get(sat.visits[0]?.node_id);
        if (!pos) continue;
        const sr = pos.r, sw = sr * NODE_W_RATIO, sh = sr * NODE_H_RATIO;
        const colorClass = (sat.pastesReceived > 0) ? ' paste' : (sat.copyCount > 0) ? ' copy' : '';

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'node' + colorClass);
        rect.setAttribute('x', pos.cx - sw / 2); rect.setAttribute('y', pos.cy - sh / 2);
        rect.setAttribute('width', sw); rect.setAttribute('height', sh);
        rect.setAttribute('rx', sr * NODE_RX_RATIO);
        overlay.appendChild(rect);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('class', 'node-label');
        label.setAttribute('x', pos.cx);
        label.setAttribute('y', pos.cy - sr * ANCHOR_TITLE_Y_RATIO);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'central');
        label.setAttribute('font-size', sr * ANCHOR_TITLE_SIZE_RATIO);
        label.textContent = truncate(placeLabel(sat.url, sat.page_title), 20);
        overlay.appendChild(label);

        const dwellMin = Math.round(sat.totalDwell / 60);
        const meta = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        meta.setAttribute('class', 'node-meta');
        meta.setAttribute('x', pos.cx);
        meta.setAttribute('y', pos.cy + sr * ANCHOR_META1_Y_RATIO);
        meta.setAttribute('font-size', sr * ANCHOR_META_SIZE_RATIO);
        meta.textContent = `${sat.visits.length} visit${sat.visits.length !== 1 ? 's' : ''} · ${dwellMin}m`;
        overlay.appendChild(meta);
      }
    });

    target.addEventListener('mouseleave', () => { overlay.innerHTML = ''; });
    targetsG.appendChild(target);
  }
}

function teardownAnchorHover() {
  const overlay = document.getElementById('satellite-overlay');
  const targetsG = document.getElementById('hover-targets');
  if (overlay) overlay.innerHTML = '';
  if (targetsG) targetsG.innerHTML = '';
}

