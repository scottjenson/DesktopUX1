function computeTreeLayout(flat, root) {
  const layout = new Map();
  const all = flatten(root);
  for (const node of all) {
    const isRoot = node.parent_node_id == null;
    layout.set(node.node_id, {
      cx: node.x,
      cy: node.y,
      r: NODE_R,
      opacity: 1,
      labelX: node.x + NODE_R + 10,
      labelY: node.y + 4,
      labelAnchor: 'start',
      labelText: truncate(shortenTitle(node.page_title), 28),
      circleClass: isRoot ? 'root-node' : '',
    });
  }
  return layout;
}

function treeBounds(root) {
  const all = flatten(root);
  const xs = all.map(n => n.x);
  const ys = all.map(n => n.y);
  return {
    minX: Math.min(...xs) - NODE_R - PAD,
    maxX: Math.max(...xs) + NODE_R + 200 + PAD,
    minY: Math.min(...ys) - NODE_R - PAD,
    maxY: Math.max(...ys) + NODE_R + PAD,
  };
}

function renderTreeEdges(root) {
  const edgesG = document.getElementById('edges');
  edgesG.innerHTML = '';
  const all = flatten(root);
  for (const node of all) {
    for (const child of node.children) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const x1 = node.x, y1 = node.y + NODE_R;
      const x2 = child.x, y2 = child.y - NODE_R;
      const midY = (y1 + y2) / 2;
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      path.setAttribute('class', 'edge');
      edgesG.appendChild(path);
    }
  }
}
