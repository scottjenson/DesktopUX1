const ANCHOR_TITLE_SIZE_RATIO = 0.30;
const ANCHOR_META_SIZE_RATIO  = 0.19;
const ANCHOR_TITLE_Y_RATIO    = 0.15;
const ANCHOR_META1_Y_RATIO    = 0.20;
const ANCHOR_META2_Y_RATIO    = 0.38;

// Returns { layout, anchorNodeIds, satNodeIds, anchorClusters, bounds }
function computeAnchorLayout(flat) {
  const { anchors, satellites } = prepareAnchorData(flat);
  if (anchors.length === 0) return { layout: new Map(), anchorNodeIds: new Set(), satNodeIds: new Set(), anchorClusters: [], bounds: null };

  const scores = anchors.map(a => a.score);
  const minS = Math.min(...scores), maxS = Math.max(...scores);
  anchors.forEach(a => { a.r = anchorRadius(a.score, minS, maxS); });

  const coms = anchors.map(a => a.centerOfMass);
  const minCom = Math.min(...coms), maxCom = Math.max(...coms);
  const comRange = (maxCom - minCom) || 1;

  anchors.forEach((a, i) => {
    a.cx = i * ANCHOR_GAP_X;
    const norm = (a.centerOfMass - minCom) / comRange;
    a.cy = ANCHOR_BAND_Y + (norm - 0.5) * VERTICAL_RANGE;
  });

  const buckets = assignSatellitesToAnchors(anchors, satellites);

  // Compute satellite positions
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
      sat.r = satelliteRadius(sat);
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
      const onLeft = Math.cos(sat._angle) < 0;
      placeMap.set(sat.url, {
        cx: sat.cx, cy: sat.cy, r: sat.r, isAnchor: false,
        onLeft,
      });
    }
  }

  // Map each of the 50 nodes to its place position
  const layout = new Map();
  const anchorNodeIds = new Set();
  const satNodeIds = new Set();

  for (const node of flat) {
    const url = normUrl(node.url);
    const place = placeMap.get(url);
    if (!place) continue;

    // Color is determined at place level so all visits to the same URL share one class
    const placeHasPaste = (place.pasteCount || 0) > 0;
    const placeHasCopy  = (place.copyCount  || 0) > 0;
    const colorClass = placeHasPaste ? ' paste' : placeHasCopy ? ' copy' : '';

    if (place.isAnchor) {
      const dwellMin = Math.round(place.totalDwell / 60);
      const meta2Text = placeHasPaste
        ? `${place.pasteCount} pastes`
        : placeHasCopy ? `${place.copyCount} copies` : '';
      layout.set(node.node_id, {
        cx: place.cx, cy: place.cy, r: place.r, opacity: 1,
        labelX: place.cx,
        labelY: place.cy - place.r * ANCHOR_TITLE_Y_RATIO,
        labelAnchor: 'middle',
        labelFontSize: place.r * ANCHOR_TITLE_SIZE_RATIO,
        labelBaseline: 'central',
        labelText: truncate(placeLabel(place.url, place.page_title), 20),
        circleClass: 'anchor' + colorClass,
        metaText: `${place.visitCount} visits · ${dwellMin}m`,
        metaX: place.cx,
        metaY: place.cy + place.r * ANCHOR_META1_Y_RATIO,
        metaFontSize: place.r * ANCHOR_META_SIZE_RATIO,
        meta2Text,
        meta2X: place.cx,
        meta2Y: place.cy + place.r * ANCHOR_META2_Y_RATIO,
      });
      anchorNodeIds.add(node.node_id);
    } else {
      layout.set(node.node_id, {
        cx: place.cx, cy: place.cy, r: place.r, opacity: 1,
        labelX: place.cx, labelY: place.cy,
        labelAnchor: 'middle',
        labelFontSize: 10,
        labelBaseline: 'auto',
        labelText: '',
        circleClass: 'satellite' + colorClass,
        metaText: '',
        metaX: place.cx,
        metaY: place.cy,
        metaFontSize: 9,
        meta2Text: '',
        meta2X: place.cx,
        meta2Y: place.cy,
      });
      satNodeIds.add(node.node_id);
    }
  }

  const allX = anchors.flatMap(a => [a.cx - a.r - SATELLITE_RING, a.cx + a.r + SATELLITE_RING]);
  const allY = anchors.flatMap(a => [a.cy - a.r - SATELLITE_RING, a.cy + a.r + SATELLITE_RING]);
  const bounds = {
    minX: Math.min(...allX) - PAD,
    maxX: Math.max(...allX) + PAD,
    minY: Math.min(...allY) - PAD - 40,
    maxY: Math.max(...allY) + PAD + 20,
  };

  // Build anchor cluster data for hover interaction
  const anchorClusters = anchors.map(a => ({
    cx: a.cx, cy: a.cy, r: a.r,
    satellites: (buckets.get(a.url) || []).map(sat => {
      const onLeft = Math.cos(sat._angle) < 0;
      return {
        labelX: sat.cx + (onLeft ? -(sat.r + 6) : (sat.r + 6)),
        labelY: sat.cy + 4,
        onLeft,
        label: truncate(placeLabel(sat.url, sat.page_title), 22),
      };
    }),
  }));

  return { layout, anchorNodeIds, satNodeIds, anchorClusters, bounds };
}

function renderAnchorEdgesAndBg(flat) {
  const { anchors } = prepareAnchorData(flat);
  if (anchors.length === 0) return;

  const scores = anchors.map(a => a.score);
  const minS = Math.min(...scores), maxS = Math.max(...scores);
  anchors.forEach(a => { a.r = anchorRadius(a.score, minS, maxS); });
  const coms = anchors.map(a => a.centerOfMass);
  const minCom = Math.min(...coms), maxCom = Math.max(...coms);
  const comRange = (maxCom - minCom) || 1;
  anchors.forEach((a, i) => {
    a.cx = i * ANCHOR_GAP_X;
    const norm = (a.centerOfMass - minCom) / comRange;
    a.cy = ANCHOR_BAND_Y + (norm - 0.5) * VERTICAL_RANGE;
  });

  const bgLayer = document.getElementById('bg-layer');
  const edgesG = document.getElementById('edges');
  bgLayer.innerHTML = '';
  edgesG.innerHTML = '';

  // Interruption band
  const interrupt = findInterruption(flat);
  if (interrupt) {
    const intIdx = flat.indexOf(interrupt);
    let left = null, right = null;
    for (const a of anchors) {
      if (a.firstIdx <= intIdx) left = a;
      else { right = a; break; }
    }
    let bandX, bandW = 60;
    if (left && right) bandX = (left.cx + right.cx) / 2 - bandW / 2;
    else if (left) bandX = left.cx + ANCHOR_GAP_X / 2 - bandW / 2;
    else if (right) bandX = right.cx - ANCHOR_GAP_X / 2 - bandW / 2;
    if (bandX !== undefined) {
      const band = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      band.setAttribute('class', 'interrupt-band');
      band.setAttribute('x', bandX); band.setAttribute('y', ANCHOR_BAND_Y - VERTICAL_RANGE);
      band.setAttribute('width', bandW); band.setAttribute('height', VERTICAL_RANGE * 2.5);
      bgLayer.appendChild(band);
      const lblY = ANCHOR_BAND_Y - VERTICAL_RANGE + 14;
      for (const [text, dy] of [['interruption', 0], ['15 min', 12]]) {
        const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lbl.setAttribute('class', 'interrupt-label');
        lbl.setAttribute('x', bandX + bandW / 2); lbl.setAttribute('y', lblY + dy);
        lbl.setAttribute('font-size', '9'); lbl.textContent = text;
        bgLayer.appendChild(lbl);
      }
    }
  }

  // Anchor-to-anchor edges
  const anchorUrls = new Set(anchors.map(a => a.url));
  const transitions = computeAnchorEdges(flat, anchorUrls);
  const anchorByUrl = new Map(anchors.map(a => [a.url, a]));
  for (const [key, rec] of transitions) {
    const [fromUrl, toUrl] = key.split('||');
    const from = anchorByUrl.get(fromUrl), to = anchorByUrl.get(toUrl);
    if (!from || !to) continue;
    const arcAbove = from.cx <= to.cx;
    const dist = Math.abs(to.cx - from.cx);
    const curveHeight = Math.min(80, 30 + dist * 0.15);
    const midX = (from.cx + to.cx) / 2;
    const midY = (from.cy + to.cy) / 2 + (arcAbove ? -curveHeight : curveHeight);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'anchor-edge' + (rec.carrierCount > 0 ? ' carrier' : ''));
    path.setAttribute('d', `M ${from.cx} ${from.cy} Q ${midX} ${midY} ${to.cx} ${to.cy}`);
    path.setAttribute('stroke-width', Math.min(6, 1 + rec.count * 0.8));
    edgesG.appendChild(path);
  }

  // Satellite link lines
  const buckets = assignSatellitesToAnchors(anchors, prepareAnchorData(flat).satellites);
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
      const angle = angleStart + t * (angleEnd - angleStart);
      const ringDist = a.r + SATELLITE_RING;
      const satCx = a.cx + Math.cos(angle) * ringDist;
      const satCy = a.cy + Math.sin(angle) * ringDist;
      const link = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      link.setAttribute('class', 'satellite-link');
      link.setAttribute('x1', a.cx + Math.cos(angle) * a.r); link.setAttribute('y1', a.cy + Math.sin(angle) * a.r);
      link.setAttribute('x2', satCx); link.setAttribute('y2', satCy);
      edgesG.appendChild(link);
    });
  }
}

// ── Hover interaction ──────────────────────────────────────────────────────────

function setupAnchorHover(anchorClusters) {
  const targetsG = document.getElementById('hover-targets');
  const labelsG = document.getElementById('hover-labels');
  targetsG.innerHTML = '';
  labelsG.innerHTML = '';

  for (const cluster of anchorClusters) {
    const satLabels = cluster.satellites.map(sat => {
      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl.setAttribute('class', 'sat-hover-label');
      lbl.setAttribute('x', sat.labelX);
      lbl.setAttribute('y', sat.labelY);
      lbl.setAttribute('text-anchor', sat.onLeft ? 'end' : 'start');
      lbl.setAttribute('font-size', 9);
      lbl.textContent = sat.label;
      lbl.style.opacity = '0';
      labelsG.appendChild(lbl);
      return lbl;
    });

    const hitTarget = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hitTarget.setAttribute('cx', cluster.cx);
    hitTarget.setAttribute('cy', cluster.cy);
    hitTarget.setAttribute('r', cluster.r);
    hitTarget.setAttribute('fill', 'transparent');
    hitTarget.setAttribute('stroke', 'none');
    hitTarget.style.cursor = 'default';
    hitTarget.addEventListener('mouseenter', () => {
      for (const lbl of satLabels) lbl.style.opacity = '1';
    });
    hitTarget.addEventListener('mouseleave', () => {
      for (const lbl of satLabels) lbl.style.opacity = '0';
    });
    targetsG.appendChild(hitTarget);
  }
}

function teardownAnchorHover() {
  document.getElementById('hover-targets').innerHTML = '';
  document.getElementById('hover-labels').innerHTML = '';
}
