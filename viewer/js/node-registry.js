// Radius used in history and tree views (anchor view uses variable radii from scoring)
const NODE_R = 8;

// Persistent SVG elements — created once, tweened across views
let nodeRegistry = new Map(); // node_id → { circle, label }

// Live positions — updated every animation frame, read by transitions.js
let currentPositions = new Map(); // node_id → { cx, cy, r, opacity }

function initNodeRegistry(flat) {
  const nodesG = document.getElementById('nodes');
  nodesG.innerHTML = '';
  nodeRegistry.clear();
  currentPositions.clear();

  for (const node of flat) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'node-circle');

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'node-label');

    nodesG.appendChild(circle);
    nodesG.appendChild(label);
    nodeRegistry.set(node.node_id, { circle, label });
    currentPositions.set(node.node_id, { cx: 0, cy: 0, r: NODE_R, opacity: 1 });
  }
}

// Apply a layout immediately — no animation. Also snaps label positions.
function applyLayout(layout) {
  for (const [id, target] of layout) {
    if (!nodeRegistry.has(id)) continue;
    const { circle, label } = nodeRegistry.get(id);
    const cx = target.cx, cy = target.cy, r = target.r, opacity = target.opacity ?? 1;

    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', r);
    circle.setAttribute('opacity', opacity);
    circle.setAttribute('class', 'node-circle' + (target.circleClass ? ' ' + target.circleClass : ''));

    label.setAttribute('x', target.labelX);
    label.setAttribute('y', target.labelY);
    label.setAttribute('text-anchor', target.labelAnchor);
    label.textContent = target.labelText ?? '';
    label.setAttribute('opacity', opacity);

    currentPositions.set(id, { cx, cy, r, opacity });
  }
}
