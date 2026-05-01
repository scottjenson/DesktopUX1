# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-history visualization prototype (`tree-viewer.html`, currently a single ~700-line file) that renders a synthetic 50-node browsing session as two interactive views. It's a worked example for a talk on "the future of desktop UX" — the central thesis being that the desktop offloads state management to the user (*the user as integrator-of-last-resort*).

## How to run

The HTML file can be opened directly in a browser, or served via:
```
python3 -m http.server 8000
```
If the project has been split into `viewer/`, open `http://localhost:8000` from that directory.

## The two views

- **`0` key** — Chronological tree: a naive tidy-tree of all 50 nodes by `parent_node_id`. Stable, not under active iteration.
- **`1` key** — Anchor constellation: the main view under development. Multi-visit URLs collapse into "places"; anchors become sized circles; satellites orbit them; edges encode copy-paste flow.

## Data

`history.json` — 50 synthetic nodes representing an ebike-research session. Each node has: `parent_node_id`, URL, title, dwell time, scroll depth, `is_anchored`, `clipboard_copy_event`, `abandonment_state`. The same URL can appear as multiple nodes (each visit is a node). No explicit `paste_event` field — pastes are inferred (see Decision 5 in `project-context.md`).

## Code structure (after the planned split)

Most active iteration happens in `anchor-view.js` and `anchor-data.js`. Treat `tree-view.js`, `pan-zoom.js`, and `url-utils.js` as stable.

```
viewer/
├── index.html        # page shell, script tags in load order
├── style.css         # all CSS
└── js/
    ├── data.js           # window.HISTORY_DATA (the 50-node array)
    ├── url-utils.js      # normUrl, placeLabel, shortenTitle, truncate
    ├── tree-layout.js    # buildTree, treeLayout, countLeaves, flatten
    ├── tree-view.js      # renderTreeView — STABLE
    ├── anchor-data.js    # prepareAnchorData: scoring, COM, satellite assignment, edges — ACTIVE
    ├── anchor-view.js    # renderAnchorView — PRIMARY ITERATION TARGET
    ├── pan-zoom.js       # drag/wheel handlers, fitToBounds, zoom visibility — STABLE
    └── main.js           # init, switchToTree, switchToAnchor, key handlers
```

No build step. No module system. Functions are globals; load order in `index.html` is the dependency order listed above.

## Key design decisions

- **Anchor sizing:** `score = sqrt(dwell) + 8×visits + 12×copies + 8×pastes_received`, radius sqrt-mapped to [28, 64]px. Active signals (copies/pastes) outweigh passive signals (dwell).
- **Vertical position:** center-of-mass of visit timestamps, not source/sink balance (source/sink was checked against the data and rejected — see `project-context.md` Decision 3).
- **Continuous zoom, not zoom tiers:** visibility of labels/metadata is gated by whether `svg_size × scale ≥ minimum_pixels_for_content`. Constants: `MIN_ANCHOR_LABEL_PX=60`, `MIN_ANCHOR_META_PX=80`, `MIN_SAT_LABEL_PX=70`, `MIN_SAT_DOT_PX=1.5`.
- **Keep URL merging:** any URL containing `keep.google.com` normalizes to `KEEP`. This is a one-off special case.
- **Paste inference:** each `clipboard_copy_event` is inferred to land on the next-visited Keep instance. A `// TODO` comment marks where explicit paste events should replace this logic.

## Open issues (from `project-context.md`)

1. Label collisions in Vado's 14-satellite halo at intermediate zoom — needs importance-aware label filtering.
2. Gazelle is positioned highest (earliest COM) but is the smallest anchor — may read confusingly.
3. Satellite assignment is chronologically naive; early satellites pile into Vado's bucket.
4. No click/hover interaction yet.

## Design principles for this project

- **Check the data before theorizing.** Run the calculation, then describe the result.
- **Active signals beat passive.** Copy/paste/anchor-flag > dwell/scrolls/return-visits.
- **Show, don't tier.** Continuous encodings beat discrete categories.
- **Surface integration labor.** Every visualization decision should ask: "does this make the user's invisible integration work visible?"
