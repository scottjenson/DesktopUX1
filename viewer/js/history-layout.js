const HISTORY_ROW_H = 30;

function computeHistoryLayout(flat) {
  const layout = new Map();
  flat.forEach((node, i) => {
    const cy = i * HISTORY_ROW_H;
    const labelText = truncate(placeLabel(normUrl(node.url), node.page_title), 30);
    layout.set(node.node_id, {
      cx: 0,
      cy,
      r: NODE_R,
      opacity: 1,
      labelX: NODE_R + 10,
      labelY: cy + 4,
      labelAnchor: 'start',
      labelFontSize: 10,
      labelBaseline: 'auto',
      labelText,
      circleClass: '',
      metaText: '',
      metaX: 0,
      metaY: cy,
      metaFontSize: 9,
      meta2Text: '',
      meta2X: 0,
      meta2Y: cy,
    });
  });
  return layout;
}

function historyBounds(flat) {
  const n = flat.length;
  return {
    minX: -(NODE_R + PAD),
    maxX: NODE_R + 240 + PAD,
    minY: -(NODE_R + PAD),
    maxY: (n - 1) * HISTORY_ROW_H + NODE_R + PAD,
  };
}
