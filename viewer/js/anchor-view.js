const ANCHOR_TITLE_SIZE_RATIO = 0.30;
const ANCHOR_META_SIZE_RATIO  = 0.19;
const ANCHOR_TITLE_Y_RATIO    = 0.15;
const ANCHOR_META1_Y_RATIO    = 0.20;
const ANCHOR_META2_Y_RATIO    = 0.38;

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
  const centerX = 500;
  const copyGap = 320;

  // Row 1: root and slack
  if (rootAnchor) { rootAnchor.cx = centerX - 180; rootAnchor.cy = topY; }
  if (slackAnchor) { slackAnchor.cx = centerX + 180; slackAnchor.cy = topY; }

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
      const totalInHalf = Math.ceil(sats.length / 2);
      let angleStart, angleEnd;
      if (half === 'top') { angleStart = -160 * Math.PI / 180; angleEnd = -20 * Math.PI / 180; }
      else                { angleStart = 20 * Math.PI / 180;   angleEnd = 160 * Math.PI / 180; }
      const t = totalInHalf === 1 ? 0.5 : idxInHalf / Math.max(1, totalInHalf - 1);
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

    layout.set(node.node_id, {
      cx: place.cx, cy: place.cy, r: place.r, opacity: 1,
      labelX: place.cx,
      labelY: place.cy - place.r * ANCHOR_TITLE_Y_RATIO,
      labelAnchor: 'middle',
      labelFontSize: place.r * ANCHOR_TITLE_SIZE_RATIO,
      labelBaseline: 'central',
      labelText: truncate(placeLabel(place.url, place.page_title), 20),
      circleClass: (place.isAnchor ? 'anchor' : '') + colorClass,
      metaText: visitLabel,
      metaX: place.cx,
      metaY: place.cy + place.r * ANCHOR_META1_Y_RATIO,
      metaFontSize: place.r * ANCHOR_META_SIZE_RATIO,
      meta2Text,
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

  return { anchors, layout, anchorNodeIds, bounds };
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
  const centerX = 500;
  const copyGap = 320;

  if (rootAnchor) { rootAnchor.cx = centerX - 180; rootAnchor.cy = topY; }
  if (slackAnchor) { slackAnchor.cx = centerX + 180; slackAnchor.cy = topY; }
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
    const dx = Math.abs(to.cx - from.cx);
    const dy = to.cy - from.cy;
    const horizontalOffset = dy > 0 ? 60 : -60;  // Bulge down if to is below, up if above
    const curveHeight = Math.min(100, 40 + Math.abs(dx) * 0.1);
    const midX = (from.cx + to.cx) / 2;
    const midY = (from.cy + to.cy) / 2 + horizontalOffset + (dy > 0 ? curveHeight : -curveHeight);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'anchor-edge' + (rec.carrierCount > 0 ? ' carrier' : ''));
    path.setAttribute('d', `M ${from.cx} ${from.cy} Q ${midX} ${midY} ${to.cx} ${to.cy}`);
    path.setAttribute('stroke-width', Math.min(6, 1 + rec.count * 0.8));
    edgesG.appendChild(path);
  }

  // Satellite link lines
  const buckets = assignSatellitesToAnchors(anchors, prepareAnchorData(flat).satellites, flat);
  for (const a of anchors) {
    const sats = buckets.get(a.url) || [];
    sats.forEach((sat, i) => {
      // Use settled position from currentPositions if available, else fall back to layout formula
      const nodeId = sat.visits[0]?.node_id;
      const settled = nodeId ? currentPositions.get(nodeId) : null;
      let satCx, satCy, startAngle;

      if (settled && settled.opacity > 0) {
        satCx = settled.cx;
        satCy = settled.cy;
        startAngle = Math.atan2(satCy - a.cy, satCx - a.cx);
      } else {
        const half = i % 2 === 0 ? 'top' : 'bottom';
        const idxInHalf = Math.floor(i / 2);
        const totalInHalf = Math.ceil(sats.length / 2);
        let angleStart, angleEnd;
        if (half === 'top') { angleStart = -160 * Math.PI / 180; angleEnd = -20 * Math.PI / 180; }
        else                { angleStart = 20 * Math.PI / 180;   angleEnd = 160 * Math.PI / 180; }
        const t = totalInHalf === 1 ? 0.5 : idxInHalf / Math.max(1, totalInHalf - 1);
        startAngle = angleStart + t * (angleEnd - angleStart);
        satCx = a.cx + Math.cos(startAngle) * (a.r + SATELLITE_RING);
        satCy = a.cy + Math.sin(startAngle) * (a.r + SATELLITE_RING);
      }

      const link = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      link.setAttribute('class', 'satellite-link');
      link.setAttribute('x1', a.cx + Math.cos(startAngle) * a.r);
      link.setAttribute('y1', a.cy + Math.sin(startAngle) * a.r);
      link.setAttribute('x2', satCx);
      link.setAttribute('y2', satCy);
      edgesG.appendChild(link);
    });
  }
}

