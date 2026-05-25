const PAD = 60;

let zoomDependent = [];

let cachedRoot = null;
let currentMode = null; // 'history' | 'tree' | 'anchor'

function _ensureTree() {
  if (!cachedRoot) {
    cachedRoot = buildTree(HISTORY_DATA);
    countLeaves(cachedRoot);
    treeLayout(cachedRoot, 0, 0);
  }
}

function _hideTelemetry() {
  document.getElementById('telemetry-layer').setAttribute('opacity', 0);
  document.getElementById('edges').setAttribute('opacity', 1);
  document.getElementById('bg-layer').setAttribute('opacity', 1);
  document.getElementById('nodes').setAttribute('opacity', 1);
  document.getElementById('satellite-overlay').setAttribute('opacity', 1);
}

function switchToHistory() {
  const prev = currentMode;
  currentMode = 'history';
  _updateViewUI('history');
  if (prev === 'anchor') teardownAnchorHover();
  _hideTelemetry();

  // Use consistent rendering for all cases (initial + transitions)
  if (prev === null || prev === 'telemetry') {
    // Initial load or coming out of empty placeholder: render directly
    applyLayout(computeHistoryLayout(HISTORY_DATA));
    document.getElementById('edges').innerHTML = '';
    fitToBounds(historyBounds(HISTORY_DATA));
  } else if (prev === 'tree') {
    transitionToHistory(HISTORY_DATA);
  } else if (prev === 'anchor') {
    _ensureTree();
    transitionDirectTo(computeHistoryLayout(HISTORY_DATA), null, historyBounds(HISTORY_DATA));
  }
}

function switchToTree() {
  const prev = currentMode;
  currentMode = 'tree';
  _updateViewUI('tree');
  if (prev === 'anchor') teardownAnchorHover();
  _hideTelemetry();
  _ensureTree();

  if (prev === null || prev === 'telemetry') {
    applyLayout(computeTreeLayout(HISTORY_DATA, cachedRoot));
    renderTreeEdges(cachedRoot);
    fitToBounds(treeBounds(cachedRoot));
    return;
  }
  if (prev === 'history') {
    transitionToTree(HISTORY_DATA, cachedRoot);
  } else if (prev === 'anchor') {
    transitionAnchorToTree(HISTORY_DATA, cachedRoot);
  }
}

function switchToAnchor() {
  const prev = currentMode;
  currentMode = 'anchor';
  _updateViewUI('anchor');
  _hideTelemetry();
  _ensureTree();

  if (prev === null || prev === 'telemetry') {
    const { anchors, buckets, layout, bounds } = computeAnchorLayout(HISTORY_DATA);
    applyLayout(layout);
    renderAnchorEdgesAndBg(HISTORY_DATA);
    fitToBounds(bounds);
    setupAnchorHover(HISTORY_DATA, anchors, buckets);
    return;
  }
  if (prev === 'tree') {
    transitionTreeToAnchor(HISTORY_DATA);
  } else if (prev === 'history') {
    const { anchors, buckets, layout: aLayout, bounds } = computeAnchorLayout(HISTORY_DATA);
    transitionDirectTo(aLayout, () => renderAnchorEdgesAndBg(HISTORY_DATA), bounds,
      () => setupAnchorHover(HISTORY_DATA, anchors, buckets));
  }
}

function _updateViewUI(mode) {
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
}

// Build the telemetry text layer once: one <text> per line of the first record.
// Returns the bounding box of the text block so the caller can fit-to-bounds.
function _ensureTelemetryLayer() {
  const layer = document.getElementById('telemetry-layer');
  if (layer.childNodes.length > 0) return layer._bounds;

  const lines = JSON.stringify(HISTORY_DATA[0], null, 2).split('\n');
  const FONT_SIZE = 22;
  const LINE_H    = FONT_SIZE * 1.5;
  const CHAR_W    = FONT_SIZE * 0.6;  // approximation for monospace
  const x0 = 0, y0 = 0;

  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const rowW = maxLen * CHAR_W;

  lines.forEach((line, i) => {
    // Background hover rect (behind the text). Shifted up by half the leading
    // so the text sits visually centered inside the highlight band.
    const rectYOffset = -(LINE_H - FONT_SIZE) / 2;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'telemetry-row');
    rect.setAttribute('x', x0);
    rect.setAttribute('y', y0 + i * LINE_H + rectYOffset);
    rect.setAttribute('width', rowW);
    rect.setAttribute('height', LINE_H);
    layer.appendChild(rect);

    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('class', 'telemetry-text');
    t.setAttribute('x', x0);
    t.setAttribute('y', y0 + i * LINE_H);
    t.setAttribute('font-size', FONT_SIZE);
    t.setAttribute('dominant-baseline', 'hanging');
    t.textContent = line;
    layer.appendChild(t);
  });

  const bounds = {
    minX: x0,
    maxX: x0 + maxLen * CHAR_W,
    minY: y0,
    maxY: y0 + lines.length * LINE_H,
  };
  layer._bounds = bounds;
  return bounds;
}

function switchToTelemetry() {
  const prev = currentMode;
  currentMode = 'telemetry';
  _updateViewUI('telemetry');
  if (prev === 'anchor') teardownAnchorHover();

  // Hide every other content layer (edges, bg, all node children) en masse
  document.getElementById('edges').setAttribute('opacity', 0);
  document.getElementById('bg-layer').setAttribute('opacity', 0);
  document.getElementById('nodes').setAttribute('opacity', 0);
  document.getElementById('satellite-overlay').setAttribute('opacity', 0);

  // Show the telemetry text and center on it
  const bounds = _ensureTelemetryLayer();
  document.getElementById('telemetry-layer').setAttribute('opacity', 1);
  fitToBounds(bounds);
}

// Keyboard: 1 = history, 2 = telemetry, 3 = tree, 4 = anchor
window.addEventListener('keydown', e => {
  if (e.key === '1') switchToHistory();
  else if (e.key === '2') switchToTelemetry();
  else if (e.key === '3') switchToTree();
  else if (e.key === '4') switchToAnchor();
});

function init() {
  if (!HISTORY_DATA || !Array.isArray(HISTORY_DATA) || HISTORY_DATA.length === 0) {
    document.getElementById('title').textContent = 'no data';
    return;
  }
  initNodeRegistry(HISTORY_DATA);

  // Setup view button listeners
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (v === 'history') switchToHistory();
      else if (v === 'telemetry') switchToTelemetry();
      else if (v === 'tree') switchToTree();
      else if (v === 'anchor') switchToAnchor();
    });
  });

  // Wait for stage element to have actual dimensions before rendering
  // (fitToBounds depends on stage.clientWidth/Height)
  const renderWhenReady = () => {
    const stage = document.getElementById('stage');
    if (stage && stage.clientWidth > 0 && stage.clientHeight > 0) {
      document.fonts.ready.then(() => switchToHistory());
    } else {
      requestAnimationFrame(renderWhenReady);
    }
  };

  renderWhenReady();
}

// Wait for data to be loaded before initializing
let initAttempts = 0;
let initCalled = false;
function initWhenReady() {
  if (initCalled) return;
  if (window.HISTORY_DATA && window.HISTORY_DATA.length > 0) {
    initCalled = true;
    init();
  } else if (initAttempts < 50) {
    // Keep polling until data arrives (max 5 seconds)
    initAttempts++;
    window._dataReadyCallback = initWhenReady;
    setTimeout(initWhenReady, 100);
  } else {
    document.getElementById('title').textContent = 'data load timeout';
  }
}

// Start waiting for data
initWhenReady();
