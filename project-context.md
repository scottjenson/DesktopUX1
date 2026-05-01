# Project Context — Browser History Visualization Prototype

This document captures the load-bearing decisions and reasoning for a prototype that visualizes browser history as a 2D pan/zoom canvas. It's meant to be loaded into a future conversation so that work can resume without re-deriving settled questions.

The prototype supports a larger talk on "the future of desktop UX," whose central thesis is that the desktop offloads its state to the human (the user as state machine, or more sharply, *the user as integrator-of-last-resort*). The visualization is a worked example: showing what's in your head when the desktop won't.

---

## The data

A synthetic JSON dataset (`history.json`, 50 nodes) representing one work session: a user researching commuter ebikes. Each node has a `parent_node_id` chain (true tree, single root), URL, page title, dwell time, scroll depth, `is_anchored` flag, `clipboard_copy_event` flag, and `abandonment_state` (deep_read, immediate_bounce, interrupted, manual_integration, interruption_gap).

The session arc: branching exploration of three product candidates (Specialized Vado, Trek Allant+, Gazelle), interrupted at node 24 by a 15-minute Slack break, then a long integration phase from ~node 33 onward where the user ping-pongs between the product pages and a Google Keep note, copying specs over.

Notable property: the same URL appears multiple times as separate nodes (each visit is a node, not each URL). The Trek page has 5 visits; Keep has 9 (across two URLs that are conceptually one place).

There is no explicit `paste_event` field. Pastes are inferred (see Decision 5).

---

## The two views

### View 1: Chronological tree (`0` key)

A direct top-down tidy-tree of all 50 nodes by `parent_node_id`. Equal-weight rectangles. Used as the "naive" baseline that the anchor view critiques. **Stable, not under active iteration.**

### View 2: Anchor constellation (`1` key)

A graph view where:
- Multi-visit URLs collapse into single "places"
- Anchors (places flagged `is_anchored`) are large circles arranged left-to-right by chronology
- Non-anchor places are small satellite dots clustered around their parent anchor
- Edges encode anchor-to-anchor transitions, thickness = transition count
- The Slack interruption appears as a faint vertical band, not a node

This is where active iteration happens.

---

## Settled design decisions and their reasoning

### Decision 1: Continuous zoom, not zoom tiers

**Choice:** Every element renders with its full content always. Visibility is gated by whether there are enough on-screen pixels for content to fit, computed as `(svg_size × current_scale) ≥ minimum_pixels_for_content`. As you zoom in, satellite labels appear, then anchor metadata, then more — purely because the geometry now allows them.

**Why this won:** Zoom tiers (low/medium/high) introduce arbitrary thresholds and don't generalize across visualization types. Continuous zoom has no thresholds — pixel space is the truth. It also matches the spatial-UI principle that objects have objective properties and zoom just brings your eye closer.

**Implementation:** A `zoomDependent` array of `{element, minScale}` records. On every zoom change, walk the array and toggle a `hidden-by-zoom` class. Constants at top of script: `MIN_ANCHOR_LABEL_PX = 60`, `MIN_ANCHOR_META_PX = 80`, `MIN_SAT_LABEL_PX = 70`, `MIN_SAT_DOT_PX = 1.5`.

### Decision 2: Anchor sizing formula

**Choice:**
```
score = sqrt(total_dwell) + 8 × visits + 12 × copies + 8 × pastes_received
radius = sqrt-mapped from min/max score onto [28, 64] px
```

**Why this formula:** Combines four signals. Dwell measures attention, visits measure return, **copies measure information extraction (active intent)**, **pastes received measure integration destination**. Without the paste term, Keep — which generates no copies of its own — would lose to product pages. With it, Keep wins as the largest anchor, which is the intended story (Keep is the integration hub).

**Computed values for current dataset:**
- Keep: 156 (r=64) — biggest
- Trek: 110 (r=53)
- Vado: 76 (r=40)
- Gazelle: 66 (r=28) — smallest

**Why active signals (copies/pastes) are weighted highest:** They represent user *intent*, not just *behavior*. Dwell can be incidental; copies are deliberate. This distinction (active vs passive signals) is likely to keep mattering as more visualizations get added.

### Decision 3: Vertical position by center-of-mass of visits

**Choice:** Each anchor's vertical position = `(normalized COM - 0.5) × VERTICAL_RANGE`, where COM is the mean chronological index of that anchor's visits. Late-session anchors sit lower, early/mid-session anchors sit higher.

**Why this won (and what didn't):** Initial proposal was "source vs sink" via in/out edge balance. **This was checked against the data and rejected** — Keep has 6 incoming and 5 outgoing edges, almost balanced, because the user ping-pongs (copy from Trek → paste in Keep → back to Trek for the next spec). Source/sink doesn't separate Keep from product anchors in this dataset.

Center-of-mass *does* separate them cleanly: product anchors cluster at COM 0.55–0.61 (used through the middle), Keep at 0.82 (late-emerging). Visually the constellation now reads as "explore-explore-explore at top, integrate at bottom" — a literal shape of the user's workflow.

**Caveat noted at decision time:** This encoding is dataset-specific. Source/sink would have been a structural property meaning the same thing across sessions. Center-of-mass reads the shape of *this* session. For now we're trading generality for legibility on the dataset we have.

### Decision 4: Carrier edges (visual encoding for copy-paste flow)

**Choice:** Anchor-to-anchor edges where the source anchor had a copy event get a different color (`--carrier: #6fa8c4`, muted blue) at higher opacity (0.65) than regular navigation edges (gold, 0.35).

**Why:** Distinguishes "the user moved between these tabs carrying information" from "the user just tab-switched." Surfaces the user-as-integration-bus pattern. Subtle by design — the visual difference is present without dominating.

### Decision 5: Inferred pastes (with a TODO to fix)

**Choice:** Each `clipboard_copy_event` is inferred to land on the next-visited Keep instance.

**Why:** The dataset has no `paste_event` field; only `clipboard_copy_event`. In this session every copy resolves cleanly to Keep, so the inference is sound here. **But the rule breaks the moment a session has multiple paste destinations.** A `// TODO: revisit when JSON capture format includes explicit paste events` comment is in the code. The data capture format should be amended to include explicit paste events as next step.

### Decision 6: URL merging — Keep is special-cased

**Choice:** Any URL containing `keep.google.com` normalizes to the literal token `KEEP`. Display label hardcoded to `"Keep"`.

**Why:** `keep.google.com/` (the landing page) and `keep.google.com/u/0/#NOTE/ebike` (the actual note) are technically different URLs but conceptually one place ("the user is in Keep"). User decided merging is correct here and flagged that **domain-specific labeling** is a real concept worth exploring later — web pages have URL-as-location-as-title conventions; apps like Keep don't. This is an arbitrary one-off for now.

### Decision 7: Slack interruption rendering

**Choice:** Faint vertical band at the chronological midpoint between flanking anchors. Subtle dark-red tint, "interruption / 15 min" label. No node, no edge participation.

**Why:** Honors the principle that interruption-state is invisible-state worth surfacing, without giving a 15-minute Slack pull a node that would dwarf the actual work.

### Decision 8: Satellite assignment

**Choice:** Each non-anchor place is assigned to the most recent anchor whose first-visit precedes the satellite's first-visit (chronologically prior). All early satellites before the first anchor get assigned to the first anchor.

**Known weakness:** This pulls a lot of early Bosch/Yamaha research satellites into Vado's bucket because Vado is the first anchor chronologically, even when those satellites conceptually relate more to a different anchor that appears later. We accepted this for now. **Likely target for a smarter assignment rule in a future iteration.**

### Decision 9: Two views, toggled by `0`/`1` keys

**Choice:** Single page, two render functions, swap by clearing the canvas and re-rendering. View 0 (tree) is the naive baseline; View 1 (anchor) is the rich view. Both kept for the demo so the contrast is teachable.

**Why both:** The talk's argument depends on showing the chronological tree as the inadequate default before showing the anchor view as the better answer. Removing the tree would lose that contrast.

---

## Open questions / known issues

1. **14 satellites in Vado's halo cause label collisions when zoomed in.** Likely fix: importance-aware label filtering — at intermediate zoom, only show labels for the highest-weight satellites in each halo, even if all dots are visible. Specifically, satellites with copy events should win label priority. Not yet implemented.

2. **Gazelle is positioned highest** (most negative y_offset) because it has the earliest center-of-mass, but it's the *smallest* anchor. This may read confusingly — "high" implying importance when it doesn't. Could compress the COM-mapping so the three product anchors land in a tighter band, with Keep clearly separated below.

3. **Domain-specific labeling** is a hardcoded special case for Keep. Real solution would be a small registry of label rules per domain. Not yet built.

4. **Active satellite assignment heuristic is naive.** A satellite about Trek motors that appears early (before Trek is first visited) is currently assigned to Vado. A smarter heuristic might look at outgoing links, content topic, or future visits to determine the "right" anchor.

5. **No node interaction yet.** Click/hover behaviors haven't been added. Hovering an anchor should probably preview details; clicking might pin a focus.

---

## What's not yet built but planned

- **Importance-aware label filtering** at intermediate zoom (highest-priority satellites get labels first as you zoom in).
- **Explicit paste events** in the JSON capture format (replacing inference logic).
- **Additional views** beyond the two we have. The framing in `Initial concepts and framing.md` suggests several more — flow over time, anchored vs. abandoned content, cross-session continuity.
- **Eventual move to 3D** per `3d-ux-prototype-notes.md` — React Three Fiber + Three.js, with the freeze/unfreeze pattern (DOM for interactive close panels, html2canvas snapshots for spatial movement). Not started.

---

## Code structure (after splitting)

After running the Claude Code split prompt, the structure should be:

```
viewer/
├── index.html              # page shell, script tags
├── style.css               # all CSS
├── js/
│   ├── data.js             # window.HISTORY_DATA = [...]
│   ├── url-utils.js        # normUrl, placeLabel, shortenTitle, truncate
│   ├── tree-layout.js      # buildTree, treeLayout, countLeaves, flatten
│   ├── tree-view.js        # renderTreeView
│   ├── anchor-data.js      # prepareAnchorData (scoring, COM, satellite assignment, edges)
│   ├── anchor-view.js      # renderAnchorView — primary iteration target
│   ├── pan-zoom.js         # stage interaction, view state, fitToBounds, zoom visibility
│   └── main.js             # init, switchToTree, switchToAnchor, key handlers
└── README.md               # how to run
```

**Most active iteration happens in `anchor-view.js` and `anchor-data.js`.** `tree-view.js`, `pan-zoom.js`, and `url-utils.js` should be considered stable.

---

## Working principles for this project

- **Check the data before theorizing.** The source/sink failure (Decision 3) was a lesson: I claimed an encoding would separate Keep from product anchors before computing it. The numbers showed otherwise. Going forward: run the calculation, then describe the result.
- **Active signals are stronger than passive signals.** Dwell, scrolls, return-visits are passive. Copy/paste, anchor-flagging, click-through are active. Weight active signals higher across all encodings.
- **Show, don't tier.** Continuous encodings (size, position, opacity) beat discrete categories (low/medium/high importance) because they don't introduce artificial thresholds.
- **The user is the integrator-of-last-resort.** This is the unifying thesis. Every visualization decision should ask: "does this help surface the integration labor the user is currently performing invisibly?"
