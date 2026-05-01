const NODE_W = 180, NODE_H = 44, SLOT_W = 100, LEVEL_H = 30;

function buildTree(flat) {
  const byId = new Map();
  flat.forEach(n => byId.set(n.node_id, { ...n, children: [] }));
  let root = null;
  for (const node of byId.values()) {
    if (node.parent_node_id == null) root = node;
    else {
      const parent = byId.get(node.parent_node_id);
      if (parent) parent.children.push(node);
    }
  }
  return root;
}

function flatten(node, out = []) {
  out.push(node);
  for (const c of node.children) flatten(c, out);
  return out;
}

function countLeaves(node) {
  if (node.children.length === 0) { node._leaves = 1; return 1; }
  let total = 0;
  for (const c of node.children) total += countLeaves(c);
  node._leaves = total;
  return total;
}

function treeLayout(node, depth, xStart) {
  node.y = depth * LEVEL_H;
  if (node.children.length === 0) {
    node.x = xStart * SLOT_W + SLOT_W / 2;
    return;
  }
  let cursor = xStart;
  for (const c of node.children) {
    treeLayout(c, depth + 1, cursor);
    cursor += c._leaves;
  }
  const first = node.children[0];
  const last = node.children[node.children.length - 1];
  node.x = (first.x + last.x) / 2;
}
