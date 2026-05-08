// Master speed multiplier. 1.0 = original durations, 2.0 = twice as slow.
const ANIM_SPEED = 2.0;

let _rafHandle = null;

function cancelTransition() {
  if (_rafHandle) { cancelAnimationFrame(_rafHandle); _rafHandle = null; }
}

function _easeInOut(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function _lerp(a, b, t) { return a + (b - a) * t; }

// ── Single-loop phase runner ──────────────────────────────────────────────────
//
// Each phase: { duration (ms before ANIM_SPEED), onStart(), onFrame(t, et), onComplete() }
// All phases share one RAF handle — nodes, viewport, and edges advance together
// from the same timestamp and easing value every frame.
// cancelTransition() stops the entire sequence with one call.

function runPhases(phases) {
  cancelTransition();
  if (!phases.length) return;

  let phaseIdx = 0;
  let phaseStart = null;

  function tick(now) {
    const phase = phases[phaseIdx];

    if (phaseStart === null) {
      phaseStart = now;
      if (phase.onStart) phase.onStart();
    }

    const t = Math.min((now - phaseStart) / (phase.duration * ANIM_SPEED), 1);
    phase.onFrame(t, _easeInOut(t));

    if (t >= 1) {
      if (phase.onComplete) phase.onComplete();
      phaseIdx++;
      phaseStart = null;
      if (phaseIdx < phases.length) _rafHandle = requestAnimationFrame(tick);
      else _rafHandle = null;
    } else {
      _rafHandle = requestAnimationFrame(tick);
    }
  }

  _rafHandle = requestAnimationFrame(tick);
}

// ── Per-frame helpers ─────────────────────────────────────────────────────────

function _snapshotPositions() {
  const snap = new Map();
  for (const [id, pos] of currentPositions) snap.set(id, { ...pos });
  return snap;
}

function _snapshotView() {
  return { x: view.x, y: view.y, scale: view.scale };
}

// Compute the target {x, y, scale} that fitToBounds would produce for given bounds.
function _targetView(bounds) {
  const w = stage.clientWidth, h = stage.clientHeight;
  const bW = bounds.maxX - bounds.minX, bH = bounds.maxY - bounds.minY;
  const scale = Math.min(w / bW, h / bH, 1);
  return {
    x: -bounds.minX * scale + (w - bW * scale) / 2,
    y: -bounds.minY * scale + (h - bH * scale) / 2,
    scale,
  };
}

// Snap labels, meta, and circleClass from targetLayout immediately, then return
// a position snapshot to interpolate from. Call this inside onStart.
function _prepareNodeTween(targetLayout) {
  for (const [id, target] of targetLayout) {
    if (!nodeRegistry.has(id)) continue;
    const { circle, label, meta } = nodeRegistry.get(id);
    if (target.circleClass !== undefined)
      circle.setAttribute('class', 'node' + (target.circleClass ? ' ' + target.circleClass : ''));
    if (target.labelText !== undefined) {
      label.setAttribute('x', target.labelX);
      label.setAttribute('y', target.labelY);
      label.setAttribute('text-anchor', target.labelAnchor);
      label.textContent = target.labelText;
      if (target.labelFontSize != null) label.setAttribute('font-size', target.labelFontSize);
      if (target.labelBaseline != null) label.setAttribute('dominant-baseline', target.labelBaseline);
    }
    if (meta && target.metaText !== undefined) {
      meta.setAttribute('x', target.metaX ?? 0);
      meta.setAttribute('y', target.metaY ?? 0);
      meta.setAttribute('text-anchor', 'middle');
      meta.textContent = target.metaText;
      if (target.metaFontSize != null) meta.setAttribute('font-size', target.metaFontSize);
    }
    const meta2 = nodeRegistry.get(id)?.meta2;
    if (meta2 && target.meta2Text !== undefined) {
      meta2.setAttribute('x', target.meta2X ?? 0);
      meta2.setAttribute('y', target.meta2Y ?? 0);
      meta2.setAttribute('text-anchor', 'middle');
      meta2.textContent = target.meta2Text;
      if (target.metaFontSize != null) meta2.setAttribute('font-size', target.metaFontSize);
    }
  }
  return _snapshotPositions();
}

function _applyNodeFrame(fromSnap, targetLayout, et) {
  for (const [id, target] of targetLayout) {
    if (!nodeRegistry.has(id)) continue;
    const from = fromSnap.get(id) || { cx: 0, cy: 0, r: NODE_R, opacity: 1, w: NODE_R * NODE_W_RATIO };
    const cx      = _lerp(from.cx,           target.cx,           et);
    const cy      = _lerp(from.cy,           target.cy,           et);
    const r       = _lerp(from.r,            target.r,            et);
    const opacity = _lerp(from.opacity ?? 1, target.opacity ?? 1, et);
    const w       = _lerp(from.w ?? from.r * NODE_W_RATIO, target.w ?? target.r * NODE_W_RATIO, et);
    currentPositions.set(id, { cx, cy, r, opacity, w });
    const { circle, label, meta, meta2 } = nodeRegistry.get(id);
    _setRectAttrs(circle, cx, cy, r, w);
    circle.setAttribute('opacity', opacity);
    label.setAttribute('opacity', opacity);
    if (meta) meta.setAttribute('opacity', opacity);
    if (meta2) meta2.setAttribute('opacity', opacity);
  }
}

function _applyViewFrame(fromView, toView, et) {
  view.x     = _lerp(fromView.x,     toView.x,     et);
  view.y     = _lerp(fromView.y,     toView.y,     et);
  view.scale = _lerp(fromView.scale, toView.scale, et);
  applyView();
}

function _edgesOpacity() {
  return parseFloat(document.getElementById('edges').getAttribute('opacity') || '1');
}

function _applyEdgesFrame(fromOp, toOp, et) {
  const o = _lerp(fromOp, toOp, et);
  document.getElementById('edges').setAttribute('opacity', o);
  document.getElementById('bg-layer').setAttribute('opacity', o);
}

// Build an opacity-only layout: same positions as current, opacity set by opacityFn(id).
function _opacityLayout(opacityFn) {
  const layout = new Map();
  for (const [id, pos] of currentPositions)
    layout.set(id, { cx: pos.cx, cy: pos.cy, r: pos.r, opacity: opacityFn(id), w: pos.w });
  return layout;
}

// ── History ↔ Tree ────────────────────────────────────────────────────────────

function transitionToTree(flat, root) {
  const tLayout = computeTreeLayout(flat, root);
  const bounds  = treeBounds(root);
  const toView  = _targetView(bounds);
  let fromSnap, fromView, fromEdgeOp;

  runPhases([
    {
      duration: 420,
      onStart() {
        document.getElementById('bg-layer').innerHTML = '';
        fromSnap   = _prepareNodeTween(tLayout);
        fromView   = _snapshotView();
        fromEdgeOp = _edgesOpacity();
      },
      onFrame(t, et) {
        _applyNodeFrame(fromSnap, tLayout, et);
        _applyViewFrame(fromView, toView, et);
        _applyEdgesFrame(fromEdgeOp, 0, et);
      },
      onComplete() {
        renderTreeEdges(root);
        document.getElementById('edges').setAttribute('opacity', '0');
      },
    },
    {
      duration: 200,
      onFrame(t, et) { _applyEdgesFrame(0, 1, et); },
      onComplete()   { fitToBounds(bounds); },
    },
  ]);
}

function transitionToHistory(flat) {
  const hLayout = computeHistoryLayout(flat);
  const bounds  = historyBounds(flat);
  const toView  = _targetView(bounds);
  let fromSnap, fromView, fromEdgeOp;

  runPhases([
    {
      duration: 420,
      onStart() {
        document.getElementById('bg-layer').innerHTML = '';
        fromSnap   = _prepareNodeTween(hLayout);
        fromView   = _snapshotView();
        fromEdgeOp = _edgesOpacity();
      },
      onFrame(t, et) {
        _applyNodeFrame(fromSnap, hLayout, et);
        _applyViewFrame(fromView, toView, et);
        _applyEdgesFrame(fromEdgeOp, 0, et);
      },
      onComplete() {
        document.getElementById('edges').innerHTML = '';
        document.getElementById('edges').setAttribute('opacity', '1');
        document.getElementById('bg-layer').setAttribute('opacity', '1');
        fitToBounds(bounds);
      },
    },
  ]);
}

// ── Physics settlement (runs after any transition to anchor view) ─────────────

function runPhysicsSettlement(flat, anchors) {
  setTimeout(() => {
    const settledLayout = settleAnchorPhysics(flat, anchors, currentPositions);
    const fromSnap = _snapshotPositions();
    let phaseStart = null;

    const settleTick = (now) => {
      if (phaseStart === null) phaseStart = now;
      const t = Math.min((now - phaseStart) / 1000, 1);
      const et = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      for (const [id, settled] of settledLayout) {
        if (!nodeRegistry.has(id)) continue;
        const from = fromSnap.get(id);
        if (!from) continue;
        const cx = _lerp(from.cx, settled.cx, et);
        const cy = _lerp(from.cy, settled.cy, et);
        const r = from.r;
        currentPositions.set(id, { cx, cy, r, opacity: from.opacity });
        const { circle, label, meta, meta2 } = nodeRegistry.get(id);
        _setRectAttrs(circle, cx, cy, r);
        if (label) { label.setAttribute('x', cx); label.setAttribute('y', cy - r * ANCHOR_TITLE_Y_RATIO); }
        if (meta)  { meta.setAttribute('x', cx);  meta.setAttribute('y',  cy + r * ANCHOR_META1_Y_RATIO); }
        if (meta2) { meta2.setAttribute('x', cx); meta2.setAttribute('y', cy + r * ANCHOR_META2_Y_RATIO); }
      }

      if (t < 1) {
        _rafHandle = requestAnimationFrame(settleTick);
      } else {
        _rafHandle = null;
        renderAnchorEdgesAndBg(flat);
      }
    };
    _rafHandle = requestAnimationFrame(settleTick);
  }, 100);
}

// ── Tree → Anchor (the important one) ────────────────────────────────────────

function transitionTreeToAnchor(flat) {
  const { anchors, buckets, layout: aLayout, anchorNodeIds, bounds } = computeAnchorLayout(flat);
  const toView = _targetView(bounds);

  // Apply anchor circle styling before animation begins, preserving color modifiers
  for (const [id, target] of aLayout) {
    if (anchorNodeIds.has(id))
      nodeRegistry.get(id).circle.setAttribute('class', 'node' + (target.circleClass ? ' ' + target.circleClass : ''));
  }

  let fromSnap, fromView, fromEdgeOp, emphLayout, restoreLayout;

  runPhases([
    // Phase 1: dim non-anchors + fade out tree edges (positions unchanged)
    {
      duration: 180,
      onStart() {
        emphLayout = _opacityLayout(id => anchorNodeIds.has(id) ? 1 : 0.2);
        fromSnap   = _prepareNodeTween(emphLayout);
        fromEdgeOp = _edgesOpacity();
      },
      onFrame(t, et) {
        _applyNodeFrame(fromSnap, emphLayout, et);
        _applyEdgesFrame(fromEdgeOp, 0, et);
      },
    },
    // Phase 2: nodes fly to anchor positions; viewport pans in the same frame
    {
      duration: 450,
      onStart() {
        fromSnap = _prepareNodeTween(aLayout);
        fromView = _snapshotView();
      },
      onFrame(t, et) {
        _applyNodeFrame(fromSnap, aLayout, et);
        _applyViewFrame(fromView, toView, et);
      },
    },
    // Phase 3: restore full opacity on anchor nodes only (satellites must stay at 0)
    {
      duration: 160,
      onStart() {
        restoreLayout = _opacityLayout(id => anchorNodeIds.has(id) ? 1 : 0);
        fromSnap      = _prepareNodeTween(restoreLayout);
      },
      onFrame(t, et) { _applyNodeFrame(fromSnap, restoreLayout, et); },
      onComplete() {
        renderAnchorEdgesAndBg(flat);
        document.getElementById('edges').setAttribute('opacity', '0');
        document.getElementById('bg-layer').setAttribute('opacity', '0');
        fitToBounds(bounds);
      },
    },
    // Phase 4: fade in anchor edges
    {
      duration: 300,
      onFrame(t, et) { _applyEdgesFrame(0, 1, et); },
      onComplete() { setupAnchorHover(flat, anchors, buckets); },
    },
  ]);
}

// ── Anchor → Tree ─────────────────────────────────────────────────────────────

function transitionAnchorToTree(flat, root) {
  const tLayout = computeTreeLayout(flat, root);
  const bounds  = treeBounds(root);
  const toView  = _targetView(bounds);
  const { anchorNodeIds } = computeAnchorLayout(flat);

  let fromSnap, fromView, fromEdgeOp, emphLayout, restoreLayout;

  runPhases([
    // Phase 1: dim non-anchors + fade out anchor edges
    {
      duration: 180,
      onStart() {
        emphLayout = _opacityLayout(id => anchorNodeIds.has(id) ? 1 : 0.2);
        fromSnap   = _prepareNodeTween(emphLayout);
        fromEdgeOp = _edgesOpacity();
      },
      onFrame(t, et) {
        _applyNodeFrame(fromSnap, emphLayout, et);
        _applyEdgesFrame(fromEdgeOp, 0, et);
      },
    },
    // Phase 2: nodes fly to tree positions; viewport pans in the same frame
    {
      duration: 450,
      onStart() {
        fromSnap = _prepareNodeTween(tLayout);
        fromView = _snapshotView();
      },
      onFrame(t, et) {
        _applyNodeFrame(fromSnap, tLayout, et);
        _applyViewFrame(fromView, toView, et);
      },
    },
    // Phase 3: restore full opacity
    {
      duration: 160,
      onStart() {
        restoreLayout = _opacityLayout(() => 1);
        fromSnap      = _prepareNodeTween(restoreLayout);
      },
      onFrame(t, et) { _applyNodeFrame(fromSnap, restoreLayout, et); },
      onComplete() {
        document.getElementById('bg-layer').innerHTML = '';
        renderTreeEdges(root);
        document.getElementById('edges').setAttribute('opacity', '0');
        fitToBounds(bounds);
      },
    },
    // Phase 4: fade in tree edges
    {
      duration: 200,
      onFrame(t, et) { _applyEdgesFrame(0, 1, et); },
    },
  ]);
}

// ── Direct jumps (non-adjacent views) ────────────────────────────────────────

function transitionDirectTo(targetLayout, renderEdgesFn, bounds, onDone) {
  const toView = _targetView(bounds);
  let fromSnap, fromView, fromEdgeOp;

  const phases = [
    {
      duration: 500,
      onStart() {
        document.getElementById('bg-layer').innerHTML = '';
        fromSnap   = _prepareNodeTween(targetLayout);
        fromView   = _snapshotView();
        fromEdgeOp = _edgesOpacity();
      },
      onFrame(t, et) {
        _applyNodeFrame(fromSnap, targetLayout, et);
        _applyViewFrame(fromView, toView, et);
        _applyEdgesFrame(fromEdgeOp, 0, et);
      },
      onComplete() {
        if (renderEdgesFn) {
          renderEdgesFn();
          document.getElementById('edges').setAttribute('opacity', '0');
          document.getElementById('bg-layer').setAttribute('opacity', '0');
        } else {
          document.getElementById('edges').innerHTML = '';
          document.getElementById('edges').setAttribute('opacity', '1');
          document.getElementById('bg-layer').setAttribute('opacity', '1');
          if (onDone) onDone();
        }
        fitToBounds(bounds);
      },
    },
  ];

  if (renderEdgesFn) {
    phases.push({
      duration: 250,
      onFrame(t, et) { _applyEdgesFrame(0, 1, et); },
      onComplete() { if (onDone) onDone(); },
    });
  }

  runPhases(phases);
}
