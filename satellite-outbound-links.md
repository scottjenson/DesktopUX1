# Feature: Satellite Outbound Navigation Links

## Goal

When a user hovers an anchor node, satellites that were "stepping stones" to another anchor should visually show that connection — drawing an edge from the satellite to its destination anchor. This makes the navigation story visible: "I found Vado *through* this Google result."

## Current state (as of last commit)

- `assignSatellitesToAnchors` walks each satellite's ancestor chain upward to find its parent anchor
- Satellites have no concept of a "destination anchor" — a child node that leads to another anchor
- The hover animation reveals satellites around their parent anchor with lines back to that anchor
- No edges are drawn from satellites to destination anchors

## What's been done so far

### Step 1 — Tag destination satellites (COMPLETE)

In `anchor-data.js` → `assignSatellitesToAnchors`:
- After bucket assignment, a pass over all satellites checks if any of their visit nodes has a child node (in `flat`) whose URL maps to an anchor
- If so, `sat.destinationAnchor` is set to that anchor object
- Only one satellite currently has this: `youtube.com/watch` (Bosch CX Motor Teardown) → `app` (Slack)

### Step 2 — Bias initial position toward destination anchor (COMPLETE)

In `anchor-view.js` → `computeAnchorLayout`:
- Satellites with `destinationAnchor` skip the fan-slot angle assignment
- Instead their `_angle` is set to `atan2(dest.cy - a.cy, dest.cx - a.cx)` — pointing directly toward the destination anchor
- Physics settle then refines from this better starting point

### Step 3 — Visual marker for dest-link satellites (COMPLETE)

- In the hover overlay (`setupAnchorHover`), `destClass = ' dest-link'` is added to the satellite's rect class
- CSS: `.node.dest-link` — orange dashed border (`stroke: #f97316; stroke-dasharray: 4 3`)
- Intentionally NOT applied to the static layout `circleClass` — doing so caused all 4 youtube.com/watch visit nodes to flash orange during transitions

**Verification needed:** Hover Google Search anchor → YouTube satellite should appear with orange dashed border, positioned toward the Slack anchor (top-right area).

## What remains to be done

### Step 4 — Draw the outbound edge (TODO)

When satellites appear on hover, for each satellite with `destinationAnchor`:
- Draw a line (or path) from the satellite's settled position to the destination anchor node
- This edge should be part of a **second animation phase** after the satellites have appeared
- On hover-out, edges fade out first (or simultaneously), then satellites collapse back

**Animation sequence:**
1. Phase 1 (existing): Satellites appear around parent anchor (APPEAR_MS = 400ms)
2. Phase 2 (new): Outbound edges fade in from satellite → destination anchor

**Reverse sequence on mouseout:**
1. Phase 1 (new): Outbound edges fade out
2. Phase 2 (existing): Satellites collapse back to parent anchor (DISAPPEAR_MS = 250ms)

Or simplify: edges fade in/out simultaneously with satellites (same opacity curve), decide based on how it looks.

### Step 5 — Visual style for outbound edges (TODO)

Currently deferred. The orange dashed border is a placeholder. Once edges are drawing correctly, revisit:
- Edge color/style distinct from anchor-to-anchor edges (which encode copy-paste flow)
- Possible: dashed line, lighter color, arrow at destination end
- These edges are semantically "navigation path," not copy-paste

### Step 6 — Remove debug marker (TODO)

Once outbound edges are drawing and look right, remove the `.node.dest-link` orange dashed border from the hover overlay — it was only for positional verification.

## Key data facts

**Important `normUrl` behavior:** `viewer/js/url-utils.js` only special-cases `keep.google.com → KEEP`. It does NOT strip query strings or paths. So each distinct URL string is its own "place." This means multiple Google searches with different `?q=` params are separate satellites, and each YouTube video with a different `?v=` is a separate satellite.

**Four satellites are currently tagged with destination anchors, all in Google Search's bucket:**

| Satellite URL | Page title | Destination anchor |
|---|---|---|
| `google.com/search?q=Specialized+Turbo+Vado` | "Specialized Turbo Vado - Google Search" | Specialized Turbo Vado 4.0 |
| `google.com/search?q=Trek+Allant+7` | "Trek Allant+ 7 - Google Search" | Trek Allant+ 7 |
| `google.com/search?q=Gazelle+Ultimate+C8` | "Gazelle Ultimate C8 - Google Search" | Gazelle Ultimate C8 |
| `youtube.com/watch?v=gazelle_c8` | "Gazelle Ultimate C8 Commute Test" | Slack (`slack://app`) |

This is a richer navigation story than the originally-stated "one satellite": the user did a broad search, then branched into 3 product-specific Google searches that each led to one of the major bike anchors, and watched a YouTube video that led them to share something in Slack.

The tagging logic is general — it will work for any future data that has this pattern.

## Files in scope

- `viewer/js/anchor-data.js` — satellite tagging (Step 1 done)
- `viewer/js/anchor-view.js` — layout bias (Step 2 done), hover overlay rendering (Steps 3, 4, 6)
- `viewer/style.css` — `.node.dest-link` marker (Step 3 done, to be removed in Step 6)

## Out of scope / constraints

- Do not touch `tree-view.js`, `pan-zoom.js`, `url-utils.js` — stable
- Do not break the existing satellite appear/disappear animation
- The physics settle in `_hoverSettle` should not need changes — the destination satellite already starts at the right angle, so the radial force keeps it there
