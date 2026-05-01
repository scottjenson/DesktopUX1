const stage = document.getElementById('stage');
const viewport = document.getElementById('viewport');
const zoomReadout = document.getElementById('zoom-readout');

let view = { x: 0, y: 0, scale: 1 };
let initialView = { x: 0, y: 0, scale: 1 };

function applyView() {
  viewport.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
  zoomReadout.textContent = view.scale.toFixed(2) + '×';
  updateZoomDependentVisibility();
}

function updateZoomDependentVisibility() {
  const s = view.scale;
  for (const item of zoomDependent) {
    if (s >= item.minScale) item.element.classList.remove('hidden-by-zoom');
    else item.element.classList.add('hidden-by-zoom');
  }
}

function fitToBounds(b) {
  const w = stage.clientWidth, h = stage.clientHeight;
  const treeW = b.maxX - b.minX, treeH = b.maxY - b.minY;
  const scale = Math.min(w / treeW, h / treeH, 1);
  const x = -b.minX * scale + (w - treeW * scale) / 2;
  const y = -b.minY * scale + (h - treeH * scale) / 2;
  view = { x, y, scale };
  initialView = { ...view };
  applyView();
}

let dragging = false;
let dragStart = { x: 0, y: 0, vx: 0, vy: 0 };

stage.addEventListener('mousedown', e => {
  dragging = true;
  stage.classList.add('dragging');
  dragStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
});
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  view.x = dragStart.vx + (e.clientX - dragStart.x);
  view.y = dragStart.vy + (e.clientY - dragStart.y);
  applyView();
});
window.addEventListener('mouseup', () => {
  dragging = false;
  stage.classList.remove('dragging');
});

stage.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = stage.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const delta = -e.deltaY * 0.0015;
  const newScale = Math.max(0.15, Math.min(8, view.scale * Math.exp(delta)));
  const k = newScale / view.scale;
  view.x = mx - (mx - view.x) * k;
  view.y = my - (my - view.y) * k;
  view.scale = newScale;
  applyView();
}, { passive: false });
