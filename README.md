# Discovering User Intent

A browser-history visualization prototype, built as a worked example for a talk on "the future of desktop UX." The central thesis: the desktop offloads state management onto the user (*the user as integrator-of-last-resort*), and that integration labor can be **inferred from raw behavioral telemetry** — dwell time, scroll depth, copy/paste events, navigation structure — rather than baked into the data as labels.

The visualization takes a synthetic 50-node browsing session (an ebike-research workflow) and presents it four different ways, each one a more opinionated reading of the same raw data. The final view ("Anchor View") collapses the session down to the six places that actually mattered, identified entirely by inference.

## Running it

```
cd viewer && python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Navigation

Four views, switched via the buttons in the header or the number keys:

| Key | View | What it shows |
|---|---|---|
| `1` | **Simple History** | The raw chronological visit list, no inference applied |
| `2` | **Telemetry** | A single JSON record showing the raw signals captured per visit |
| `3` | **Tree View** | The full parent-child visit tree, one node per visit |
| `4` | **Anchor View** | The inferred constellation: the six "anchor" places the user actually engaged with, satellites orbiting them, copy-paste flow as edges |

In the Anchor View, hovering an anchor reveals its satellite cluster. Satellites that led to *other* anchors get drawn on an outer ring with an arrow showing where the user went next.

## Camera controls

- **Drag** to pan
- **Scroll** (or pinch-zoom on a trackpad) to zoom
- The camera is shared across all views — zoom in on Anchor View, switch to Tree, and you stay zoomed in

## Project structure

`viewer/` — the running prototype (HTML/CSS/vanilla JS, no build step)
`scripts/` — standalone Node scripts (anchor-inference regression test)
`CLAUDE.md` — design decisions and future-prototype directions for contributors
`project-context.md` — narrative context for the talk
