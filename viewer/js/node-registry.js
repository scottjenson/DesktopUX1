// Radius used in history and tree views (anchor view uses variable radii from scoring)
const NODE_R = 8;

// Persistent SVG elements — created once, tweened across views
let nodeRegistry = new Map(); // node_id → { circle, label, meta }

// Live positions — updated every animation frame, read by transitions.js
let currentPositions = new Map(); // node_id → { cx, cy, r, opacity }

function _setRectAttrs(el, cx, cy, r) {
  const w = r * NODE_W_RATIO, h = r * NODE_H_RATIO;
  el.setAttribute('x', cx - w / 2);
  el.setAttribute('y', cy - h / 2);
  el.setAttribute('width', w);
  el.setAttribute('height', h);
  el.setAttribute('rx', r * NODE_RX_RATIO);
}

function initNodeRegistry(flat) {
  const nodesG = document.getElementById('nodes');
  nodesG.innerHTML = '';
  nodeRegistry.clear();
  currentPositions.clear();

  for (const node of flat) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    circle.setAttribute('class', 'node');

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'node-label');

    const meta = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    meta.setAttribute('class', 'node-meta');

    const meta2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    meta2.setAttribute('class', 'node-meta');

    nodesG.appendChild(circle);
    nodesG.appendChild(label);
    nodesG.appendChild(meta);
    nodesG.appendChild(meta2);
    nodeRegistry.set(node.node_id, { circle, label, meta, meta2 });
    currentPositions.set(node.node_id, { cx: 0, cy: 0, r: NODE_R, opacity: 1 });
  }
}

// Apply a layout immediately — no animation. Also snaps label and meta positions.
function applyLayout(layout) {
  for (const [id, target] of layout) {
    if (!nodeRegistry.has(id)) continue;
    const { circle, label, meta, meta2 } = nodeRegistry.get(id);
    const cx = target.cx, cy = target.cy, r = target.r, opacity = target.opacity ?? 1;

    _setRectAttrs(circle, cx, cy, r);
    circle.setAttribute('opacity', opacity);
    circle.setAttribute('class', 'node' + (target.circleClass ? ' ' + target.circleClass : ''));

    label.setAttribute('x', target.labelX);
    label.setAttribute('y', target.labelY);
    label.setAttribute('text-anchor', target.labelAnchor);
    label.textContent = target.labelText ?? '';
    label.setAttribute('opacity', opacity);
    if (target.labelFontSize != null) label.setAttribute('font-size', target.labelFontSize);
    if (target.labelBaseline != null) label.setAttribute('dominant-baseline', target.labelBaseline);

    meta.setAttribute('x', target.metaX ?? cx);
    meta.setAttribute('y', target.metaY ?? cy);
    meta.textContent = target.metaText ?? '';
    meta.setAttribute('opacity', opacity);
    if (target.metaFontSize != null) meta.setAttribute('font-size', target.metaFontSize);

    meta2.setAttribute('x', target.meta2X ?? cx);
    meta2.setAttribute('y', target.meta2Y ?? cy);
    meta2.textContent = target.meta2Text ?? '';
    meta2.setAttribute('opacity', opacity);
    if (target.metaFontSize != null) meta2.setAttribute('font-size', target.metaFontSize);

    currentPositions.set(id, { cx, cy, r, opacity });
  }
}
