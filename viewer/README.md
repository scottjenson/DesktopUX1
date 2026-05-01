# history tree viewer

A browser-history visualization prototype that renders a synthetic 50-node browsing session (an ebike research session) as an interactive pan/zoom canvas. It demonstrates that the standard chronological view of browser history fails to surface the integration labor users perform — and offers an anchor constellation view as a richer alternative. Both views use continuous zoom for legibility: labels and metadata appear as you zoom in, gated purely by available pixel space.

## Views

| Key | View |
|-----|------|
| `0` | **Chronological tree** — naive tidy-tree of all 50 nodes by parent link. Stable baseline. |
| `1` | **Anchor constellation** — multi-visit URLs collapsed into places; anchored places sized by importance score; satellites orbit their anchor; edges encode copy-paste flow. Active iteration target. |

## How to run

```
cd viewer
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## File map

| File | What it does |
|------|-------------|
| `index.html` | Page shell, DOM structure, script tags in load order |
| `style.css` | All CSS — layout, colors, tree and anchor view classes |
| `js/data.js` | `window.HISTORY_DATA` — the 50-node synthetic session array |
| `js/url-utils.js` | `normUrl`, `placeLabel`, `shortenTitle`, `truncate` |
| `js/tree-layout.js` | `buildTree`, `flatten`, `countLeaves`, `treeLayout` — tree constants |
| `js/tree-view.js` | `renderTreeView` — draws the chronological tree into SVG |
| `js/anchor-data.js` | `prepareAnchorData`, scoring, COM, satellite assignment, edges — anchor constants |
| `js/anchor-view.js` | `renderAnchorView` — primary iteration target |
| `js/pan-zoom.js` | Drag/wheel handlers, `view` state, `fitToBounds`, zoom-visibility updates |
| `js/main.js` | `init`, `switchToTree`, `switchToAnchor`, key handlers, `zoomDependent`, `clearCanvas` |
