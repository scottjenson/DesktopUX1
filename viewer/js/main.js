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

function switchToHistory() {
  const prev = currentMode;
  currentMode = 'history';
  _updateViewUI('history');

  // Use consistent rendering for all cases (initial + transitions)
  if (prev === null) {
    // Initial load: render directly with no animation
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
  _ensureTree();

  if (prev === null) {
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
  _ensureTree();

  if (prev === null) {
    const { layout, bounds } = computeAnchorLayout(HISTORY_DATA);
    applyLayout(layout);
    renderAnchorEdgesAndBg(HISTORY_DATA);
    fitToBounds(bounds);
    return;
  }
  if (prev === 'tree') {
    transitionTreeToAnchor(HISTORY_DATA);
  } else if (prev === 'history') {
    const { layout: aLayout, bounds } = computeAnchorLayout(HISTORY_DATA);
    transitionDirectTo(aLayout, () => renderAnchorEdgesAndBg(HISTORY_DATA), bounds);
  }
}

function _updateViewUI(mode) {
  const labels = { history: 'history', tree: 'chronological tree', anchor: 'anchor constellation' };
  document.getElementById('view-name').textContent = labels[mode];
  document.getElementById('node-count').textContent = HISTORY_DATA.length;
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
}

// Keyboard: 1 = history, 2 = tree, 3 = anchor
window.addEventListener('keydown', e => {
  if (e.key === '1') switchToHistory();
  else if (e.key === '2') switchToTree();
  else if (e.key === '3') switchToAnchor();
});

function init() {
  if (!HISTORY_DATA || !Array.isArray(HISTORY_DATA) || HISTORY_DATA.length === 0) {
    document.getElementById('node-count').textContent = 'no data';
    return;
  }
  initNodeRegistry(HISTORY_DATA);

  // Setup view button listeners
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (v === 'history') switchToHistory();
      else if (v === 'tree') switchToTree();
      else if (v === 'anchor') switchToAnchor();
    });
  });

  // Wait for stage element to have actual dimensions before rendering
  // (fitToBounds depends on stage.clientWidth/Height)
  const renderWhenReady = () => {
    const stage = document.getElementById('stage');
    if (stage && stage.clientWidth > 0 && stage.clientHeight > 0) {
      switchToHistory();
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
    document.getElementById('node-count').textContent = 'data load timeout';
  }
}

// Start waiting for data
initWhenReady();
