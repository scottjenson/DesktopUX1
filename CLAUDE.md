# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-history visualization prototype that renders a synthetic 50-node browsing session as an interactive view. It's a worked example for a talk on "the future of desktop UX" — the central thesis being that the desktop offloads state management to the user (*the user as integrator-of-last-resort*), and that user intent can be **inferred from raw behavioral telemetry** rather than baked into the data as labels.

## How to run

The project lives in `viewer/`. From the project root:

```
cd viewer && python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## The two views

- **`0` key** — Chronological tree: a naive tidy-tree of all 50 nodes by `parent_node_id`. Stable, not under active iteration.
- **`1` key** — Tree constellation: a branching tree of the user history.
- **`2` key** — Anchor constellation: the main view. Multi-visit URLs collapse into "places"; anchors become sized rounded rectangles; satellites orbit them; edges encode copy-paste flow.

## Data

`viewer/history2.json` — 50 synthetic nodes representing an ebike-research session. Each node carries:

- `node_id`, `parent_node_id`, `url`, `page_title` — structure
- `active_signals.dwell_time_seconds` — time on page
- `active_signals.max_scroll_depth_percent` — % of page scrolled (filters background-tab dwell)
- `active_signals.clipboard_event` — `"copy" | "paste" | null` (room for `"cut"` later)
- `transition_type` — how the user arrived: `google_search`, `clicked_link`, `tab_switch`, `app_switch`, `opened_in_new_tab`, `opened_app`, `in_app_action`, `form_submit`
- `snapshot` — placeholder (`null`) for future screenshot file path

The same URL can appear as multiple nodes (each visit is a node). The `is_anchored`, `intent_label`, `abandonment_state`, `selection_evaporated`, `granularity_tier`, `render_mode`, and `texture_state` fields were intentionally removed — they were either baked-in narrative or capture-system metadata that undermined the inference-from-raw-signals thesis.

## Code structure

Most active iteration happens in `anchor-view.js` and `anchor-data.js`. Treat `tree-view.js`, `pan-zoom.js`, and `url-utils.js` as stable.

```
viewer/
├── index.html        # page shell, script tags in load order
├── style.css         # all CSS
└── js/
    ├── data.js           # fetches history2.json into window.HISTORY_DATA
    ├── url-utils.js      # normUrl, placeLabel, shortenTitle, truncate
    ├── tree-layout.js    # buildTree, treeLayout, countLeaves, flatten
    ├── tree-view.js      # renderTreeView — STABLE
    ├── anchor-data.js    # prepareAnchorData: scoring, anchor inference, satellite assignment, edges
    ├── anchor-view.js    # renderAnchorView, hover overlay, outbound edges
    ├── pan-zoom.js       # drag/wheel handlers, fitToBounds, zoom visibility — STABLE
    └── main.js           # init, switchToTree, switchToAnchor, key handlers
```

No build step. No module system. Functions are globals; load order in `index.html` is the dependency order listed above.

## Key design decisions

### Anchor inference (multi-signal score)

A place becomes an anchor when its score clears the threshold (currently 200). The score is the sum of:

- `0.3 × maxDwell × (maxScroll/100)` — *active* reading time. Multiplying by scroll filters background-tab dwell.
- `150 × copyCount` — each copy is a strong active-engagement signal
- `80 × pastesReceived` — paste destination = "sink for collected value"
- `120 × min(maxChildren − 2, 5)` — structural hub bonus
- `+250` if any visit dwelled > 700s — fallback for under-instrumented sources (Slack-style apps with no scroll/copy signal)

Weights were tuned in `scripts/test-anchor-equivalence.js` via grid search to match the originally labeled anchor set with a wide margin. On the current dataset the lowest-scoring anchor scores ~376; the highest non-anchor scores ~122. **Each anchor passes for a different reason** (Keep on pastes, Trek on copies, Google Search on hub structure, Slack on the fallback), which is the healthy sign of a multi-signal model.

### Satellite outbound links (dest-link)

When hovering an anchor, satellites that have a child node leading to a *different* anchor get marked as "dest-link" satellites and rendered as a visible halo on an outer ring at the angle pointing toward their destination anchor. After the appearance animation, an arrow edge fades in from each dest-link satellite to its destination anchor. Implementation details:

- Detection happens in `assignSatellitesToAnchors` (sets `sat.destinationAnchor`)
- During hover, `_hoverSettle` seeds dest-link sats at their target angle on an outer ring (innerR + 80px); non-dest sats are packed into the single largest arc between them with no overlap
- An angular tether force keeps dest-link sats locked at their target angle through collisions
- Google-search dest-link sats use the same accent tan as the Google Search anchor (with a thinner border to signal "lesser"); non-search dest-link sats rely on the outbound edge alone

### Other decisions

- **Continuous zoom, not zoom tiers:** visibility of labels/metadata is gated by whether `svg_size × scale ≥ minimum_pixels_for_content`. Constants: `MIN_ANCHOR_LABEL_PX=60`, `MIN_ANCHOR_META_PX=80`.
- **Keep URL merging:** any URL containing `keep.google.com` normalizes to `KEEP`. This is the one normalization special case; everything else preserves query strings (so `google.com/search?q=A` and `google.com/search?q=B` are distinct places).
- **Search vs. generic anchors:** anchors whose URL contains `google.com/search` get a tan accent stroke; all other anchors get a neutral gray. Search is a distinct semantic channel, not "the default anchor color."
- **Pastes are explicit data**, not inferred. `clipboard_event: "paste"` on a Keep visit means a paste landed there. The previous chronological-inference rule was lossy (multiple copies before a Keep visit silently collapsed into a single paste).

## Future-prototype directions

Things deliberately deferred or out of scope for this prototype that would strengthen the thesis:

1. **`transition_type` as a behavioral signal.** Currently captured but unused. Could (a) replace the URL-substring check for "is this a search?", (b) treat `tab_switch`/`app_switch` as negative signals ("user's attention left the research"), or (c) drive different edge styling per how-they-got-there.
2. **`snapshot` populated with real screenshot paths.** Today it's `null` placeholder. Future capture pipeline could store an image per visit, enabling rich hover previews.
3. **Surface scroll-vs-dwell mismatch visually.** A page with high dwell but low scroll (the YouTube "left in background tab" pattern) currently just fails to become an anchor. A future prototype could *show* this — e.g. semi-transparent rendering, or a "left in background" badge.
4. **`clipboard_event: "cut"`.** Schema supports it; demo data doesn't have any.
5. **Continuous anchor-ness instead of binary.** Currently a place is anchor-or-satellite. The underlying `anchorScore` is continuous and could drive size and visual prominence directly, with the anchor/satellite split happening only as a layout constraint.
6. **Slack as a distinct "abandonment" or "terminal" category.** Currently classified as a normal anchor via the dwell fallback, but its score breakdown reveals it's structurally different (no copies, no scroll, no hub — just a long-dwell context-switch destination). Could become a third class.
7. **Better Slack-style telemetry.** Slack only qualifies via the high-dwell fallback because we have no signal for "user was active in the channel" — no keystroke count, no message-sent count, no button-press count. The fallback is a pragmatic hack acknowledging missing telemetry.
8. **Multi-destination paste inference.** The previous chronological "next Keep visit" rule has been replaced with explicit paste data, so this is handled — but the lesson generalizes: when a single signal can land in multiple places, capture the destination, don't infer it.

## Design principles for this project

- **Check the data before theorizing.** Run the calculation, then describe the result.
- **Multi-signal beats single-signal.** A single threshold on dwell is easy to game (background tab). Combining dwell × scroll + copies + pastes + hub structure is harder to spoof and exposes the inference logic.
- **Show, don't tier.** Continuous encodings beat discrete categories.
- **Surface integration labor.** Every visualization decision should ask: "does this make the user's invisible integration work visible?"
- **Prefer explicit data over inference at code level.** When telemetry can capture a signal directly (e.g. paste events), capture it. Inferring signals from chronological ordering hides assumptions.
