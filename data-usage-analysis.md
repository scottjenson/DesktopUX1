# JSON Data Usage Analysis

Audit of `viewer/history2.json` against the JS code in `viewer/js/`. Each node has 16 fields (top-level + nested under `active_signals`). This document lists which are used, which are dead, and what semantic signal each dead field could contribute if surfaced.

## Used fields (7 of 16)

| Field | Where used | Purpose |
|---|---|---|
| `url` | everywhere | Primary identity. Grouped via `normUrl()` into "places." Drives anchor/satellite assignment, edge computation, label rendering. |
| `node_id` | everywhere | Identifies individual visits. Used for parent lookups, layout maps, anchor identification, hover targets. |
| `parent_node_id` | `anchor-data.js`, `tree-layout.js` | Builds the visit tree. Used to (a) walk ancestors to find a satellite's parent anchor, (b) detect "hub" nodes (≥3 children → anchor), (c) detect satellite → anchor outbound links for dest-link tagging. |
| `page_title` | `anchor-view.js`, `url-utils.js` | Rendered as the node label (after `shortenTitle()` strips trailing "\| Foo" suffixes). |
| `active_signals.dwell_time_seconds` | `anchor-data.js` | Two roles: (a) anchor detection — `>700s` triggers `isAnchored`, (b) anchor scoring — `score = sqrt(dwell) + 8×visits + 12×copies + 8×pastes`, and (c) `nodeScore()` for satellite sizing. Also displayed in node labels as "Nm" minutes. |
| `active_signals.clipboard_copy_event` | `anchor-data.js` | Counts copies per place; feeds into anchor score and `copyCount`. Also used to infer paste destinations (each copy lands on the next Keep visit). Anchor edges with copies are styled as "carrier" edges. |
| `is_anchored` | `anchor-data.js` (line 38) | One of three triggers for `place.isAnchored` (along with hub detection and high dwell). |

## Dead fields (8 of 16)

All values listed below are from the actual data — these are real signals the prototype is capturing but not surfacing.

### `intent_label` (string, per node)

**Sample values:**
- "Formulating initial research query"
- "Scanning listicle for initial models"
- "Seeking secondary expert opinions"
- "Sourcing anecdotal user reviews"
- "Verifying commenter credibility"
- "Comparing motor reliability"
- "Investigating manufacturer claims"
- "Watching technical breakdown"

**What it conveys:** A human-readable description of the user's intent for that visit. The most semantically rich field in the dataset — directly answers "why did the user go there?" without inference. Surfacing this would be a major step toward the project's stated goal of "making the user's invisible integration work visible."

**Possible uses:** Hover tooltip on satellites, replacement for the bare URL label on anchors, or an "intent timeline" along the bottom of the view.

---

### `abandonment_state` (string, per node)

**Sample values:** `deep_read`, `immediate_bounce`, `interrupted`, `interruption_gap`, `manual_integration`

**What it conveys:** What happened at the end of the visit. `deep_read` and `manual_integration` are productive endings; `immediate_bounce` and `interrupted` are not.

**Current status:** `findInterruption()` in `anchor-data.js` references this field, but the function is defined and never called. Effectively dead.

**Possible uses:** Bounce nodes could be visually de-emphasized (lower opacity), interrupted visits could carry a small marker, "interruption gaps" could appear as visible breaks in the timeline.

---

### `transition_type` (string, per node)

**Sample values:** `google_search`, `clicked_link`, `opened_in_new_tab`, `app_switch`, `tab_switch`, `form_submit`, `opened_app`, `in_app_action`

**What it conveys:** How the user got to this node. Distinguishes "the user typed a search" from "they clicked a link" from "they switched tabs/apps."

**Possible uses:** This would be a more rigorous detection signal than the current URL-substring check for `google.com/search`. It could also flag `tab_switch`/`app_switch` events as moments where the user's attention left the main flow — the kind of context-switching that the project's thesis cares about. Edge styling could vary by transition type.

---

### `active_signals.max_scroll_depth_percent` (number, per node)

**Sample values:** `5`, `10`, `15`, `20`, `45`, `60`, `85`, `90`

**What it conveys:** How far down the page the user scrolled. A 5% scroll signals "barely engaged" even if dwell time is high (e.g. the tab was open in the background).

**Possible uses:** Could refine the engagement signal — currently a 700-second dwell with 5% scroll is treated the same as 700-second dwell with 90% scroll. Combining dwell × scroll-depth would catch "tab left open while doing something else" vs. "actually read this." Could affect anchor scoring or render satellites at different opacities.

---

### `active_signals.selection_evaporated` (boolean, per node)

**Sample values:** `true`, `false`

**What it conveys:** The user selected text but then navigated away without copying. A "near-copy" — they identified something interesting but didn't act on it.

**Possible uses:** Especially relevant to the project's thesis about copy/paste flow. A selection_evaporated event is *almost* an anchor signal — the user found something worth highlighting but the task interrupted them. Could be rendered as a faint version of the copy halo.

---

### `granularity_tier` (number, per node — values 1, 2, 3)

**Sample values:** `1`, `2`, `3`

**What it conveys:** Likely a pre-computed importance/granularity bucket assigned during data capture. Without docs, the meaning is opaque — could be "tier 1 = critical, tier 3 = trivial" or the reverse.

**Possible uses:** Possibly redundant with the prototype's own dwell+copy scoring. Worth comparing against `score` to see if it's a useful shortcut or if the prototype's score does better.

---

### `render_mode` (string, per node)

**Sample values:** `spatial_mesh`, `interactive_dom`

**What it conveys:** Appears to be metadata about how the page was rendered/captured. `spatial_mesh` could be a 3D/VR context; `interactive_dom` is a regular web page.

**Possible uses:** Probably future-facing — relevant if the demo expands to mix browser history with spatial/VR sessions. Not useful for the current ebike-research story.

---

### `texture_state` (string, per node)

**Sample values:** `static_snapshot`, `live_canvas`

**What it conveys:** Similar to `render_mode` — appears to describe what kind of capture was taken. `static_snapshot` is a frozen screenshot; `live_canvas` is interactive content.

**Possible uses:** Same as `render_mode` — appears to be infrastructure metadata, not a behavioral signal. Likely safe to ignore for the talk's narrative.

---

## Summary

- **Used:** 7 fields, all the structural ones (`url`, `node_id`, `parent_node_id`, `page_title`) plus the engagement signals already in the README (`dwell_time_seconds`, `clipboard_copy_event`, `is_anchored`).
- **Highest-value dead fields for the project's thesis:** `intent_label` (directly states user intent), `abandonment_state` (interruption signals), `transition_type` (how the user got there), `max_scroll_depth_percent` (real engagement vs. background tab), `selection_evaporated` (near-copy).
- **Likely-irrelevant dead fields:** `granularity_tier` (opaque, possibly redundant), `render_mode` and `texture_state` (capture metadata, not user behavior).

The data carries substantially more signal than the prototype currently surfaces — particularly around *intent* and *abandonment*, both of which speak directly to the talk's "user as integrator-of-last-resort" framing.
