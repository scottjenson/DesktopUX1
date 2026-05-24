# Planning Doc: Inferring Anchors from Raw Signals

## The thesis to validate

The current prototype demonstrates a story the data already tells — `is_anchored` is a flat boolean baked into every node, and `intent_label` contains pre-written narrative descriptions. This makes the visualization easy to build but undermines the central claim that we can *infer* user intent from low-level telemetry.

The next major pass should ignore the opinionated fields (`is_anchored`, `intent_label`) and rebuild anchor identification + sizing from raw behavioral signals. If the inferred anchors closely match the labeled ones, that's evidence the inference works. If they diverge, that's even more interesting — either the inference is catching signals the labeler missed, or revealing where the labeler was lazy.

## Question 1: What makes a node an anchor?

Today's logic — three triggers, any one suffices:
- `node.is_anchored === true` (baked-in label — to be removed)
- Hub structure: `childCount ≥ 3` (structural, keep)
- High dwell: `dwell_time_seconds > 700` (single-signal threshold)

Move to a **multi-signal composite score**, where the only opinionated parameter becomes a single threshold (or top-K cutoff).

### Candidate raw signals

| Signal | Why it matters | Caveat |
|---|---|---|
| `dwell_time_seconds` | Time spent | A backgrounded tab dwells forever |
| `max_scroll_depth_percent` | Active reading | Doesn't apply to non-scrollable apps (Slack, Keep) |
| `clipboard_copy_event` | Strongest engagement signal — user extracted value | Sparse |
| `selection_evaporated` | Near-engagement; almost copied | Weaker than copy but more common |
| `clipboard_paste_event` (inferred) | Destination of value — anchor as "sink" | Currently only inferred for Keep |
| `transition_type` | `google_search` and `clicked_link` carry different intent than `tab_switch`/`app_switch` | Categorical, needs weighting |
| `parent_node_id` graph structure | Hub = pivot point in the user's flow | Already used — keep |

### Proposed composite score (starting point — to be tuned)

```
engagement =
    dwell_seconds × (scroll_depth_pct / 100)   // "real" dwell, not background
  + 60  × copy_count                            // copy ≈ 60s of focused engagement
  + 15  × selection_evaporated                  // near-copy ≈ 15s
  + 40  × pastes_received                       // being a paste destination = strong anchor signal

hub_bonus = clamp(children - 2, 0, 5) × 30      // structural pivot

score = engagement + hub_bonus
```

Anchor = top-K by score, or score > T. The single opinionated parameter (K or T) replaces the per-node `is_anchored` boolean.

**Important: paste events are key for Keep.** Keep is engagement-rich because the user pasted 8 things into it. Without including pastes in the score, Keep would fail the anchor test (low scroll, modest dwell per visit). With pastes weighted heavily, Keep correctly stands out.

**Slack is an interesting failure case to watch.** Slack has very long dwell time but no scroll, no copies, no pastes, and is an `app_switch` transition. Under the proposed score, Slack might *not* qualify as an anchor — which is arguably correct: Slack is where the research died, not a research finding. Whether we want to surface that as "anchor that's actually a failure mode" or simply demote it from anchor status is a thesis-level decision.

### Score philosophy — three flavors to consider

1. **Additive (proposed above)** — signals stack. Easy to compute, easy to explain. Bias: high-dwell pages can dominate even with no other engagement.
2. **Multiplicative** — `score = dwell × scroll × (1 + copies)`. Any zero signal kills the score. Bias: aggressively filters background-tab cases but cruel to single-signal pages.
3. **Gated** — node must clear N of M independent thresholds (e.g. dwell > 300 AND (scroll > 30 OR copy ≥ 1 OR pastes_received ≥ 1)). Most interpretable but rigid.

Additive feels right as a starting point. We can ablate against multiplicative later.

## Question 2: What determines node size?

Today's logic: `radius = sqrt(dwell)` mapped to `[28, 64]` px for anchors, `[12, 40]` px for satellites.

Single-signal sizing has the same critique as single-signal anchor detection — gamed by background tabs, doesn't reflect actual engagement.

**Proposal:** Reuse the same engagement score (or a sub-component of it) for sizing.

```
size_score = engagement   // same components as anchor score, minus hub_bonus
radius = sqrt-map(size_score, [min, max])
```

This means anchor identification and size both fall out of the same multi-signal inference, which is conceptually cleaner. A page that *barely* passes the anchor threshold is also small. A page that crushes the engagement score (Vado: many visits, multiple copies, high dwell, deep scrolls) becomes large.

The hub_bonus is intentionally excluded from sizing — hub structure determines anchor status but shouldn't inflate physical size, since hub-ness is about network position, not user engagement.

## Question 3: Binary anchor membership vs. continuous anchor-ness

Today's logic: a node is anchor or satellite. Binary. This drives layout (anchors get rows, satellites orbit) and rendering (anchor styling vs. satellite styling).

**Alternative:** Anchor-ness is a continuous score that drives size and visual prominence. The "anchor vs. satellite" split happens only as a layout constraint (we need *some* nodes to be hub-and-spoke centers).

This would mean:
- Top scores → anchors (positioned in the row layout)
- Bottom scores → satellites (orbit their nearest top-scorer)
- Middle scores → ambiguous, render at intermediate size and stroke weight

This is a deeper architectural shift than questions 1 & 2 but might be a more honest expression of the thesis. The current binary feels like another piece of baked-in opinion: "anchor or not" rather than "how much of an anchor."

**Counter-argument for keeping binary:** The visual story benefits from a clear hierarchy. A continuum risks visual mush. The compromise: keep the binary for layout, but show the underlying continuous score as a tooltip or debug overlay.

## Question 4: Stress-test cases — Keep and Slack

Two anchors in the current dataset that the inference engine must handle correctly:

### Keep — should pass

- 9 visits, ~7m total dwell, 8 pastes received
- Scroll depth low (it's a list, not a long article)
- No copies, no clipboard sources
- **Inference verdict:** Should pass strongly. `pastes_received × 40 = 320` alone makes this a major anchor, before any dwell counts. Keep being a paste sink is itself the engagement signal.

### Slack — should fail (or qualify with a flag)

- 1 visit, very long dwell (~15m)
- Zero scroll signal (app, not page)
- No copies, no pastes, no selections
- `transition_type: app_switch` (the user left the research)
- **Inference verdict:** Under additive scoring with scroll-weighted dwell, Slack scores low — `dwell × scroll = 15m × 0 = 0`. It only gets credit from the raw dwell baseline, which we may not include. Slack would *fail* the anchor test.

This is arguably correct. Slack isn't a research finding; it's an interruption. If we want Slack to still appear (to tell the story of "the research ended in Slack"), it should be visually distinct — perhaps as a "terminal node" or "abandonment anchor" rather than a peer of Vado/Trek/Gazelle.

**Open question:** Do we want a separate category for "engagement-poor but structurally significant" nodes? (Slack as a node where the user *ended up* even though they didn't engage with it.) This could be a third class alongside anchor/satellite.

## What to keep around for validation, not inference

Even though we're ignoring these as inputs to the inference, keep them visible for debugging:

- `is_anchored` — ground truth for validation. Show inference accuracy by comparing inferred vs. labeled.
- `intent_label` — semantic ground truth. Show as a debug tooltip on hover ("the data labels this as: 'Scanning listicle for initial models'"). If the inference identifies a page as an anchor that has a passive intent_label ("background reference"), that's a signal something's off.

## Next session prep

Before coding, we need to lock down:

1. **Final signal list and weights.** Are the weights I proposed (60/15/40 for copy/select/paste) reasonable? Should `transition_type` factor in?
2. **Threshold or top-K?** Pick one.
3. **Score philosophy.** Additive vs. multiplicative vs. gated.
4. **Binary or continuous anchor-ness** (question 3).
5. **What to do about Slack** if it fails the inference test (question 4).

Then we can run a calculation pass against the existing dataset, see which 5-6 nodes the score elevates, and compare against the current 6 anchors before writing any new code.

## Development workflow: validate the inference outside the visualization

Treat this as a pure data exercise, decoupled from the renderer. Build a standalone JS script (e.g. `scripts/anchor-inference.js`) that:

1. Loads `history2.json`
2. Runs the candidate inference function over each node/place
3. Outputs the inferred anchor set
4. Diffs it against the set of places that have `is_anchored === true` in the source data
5. Prints a confusion matrix or simple "matched / missed / extra" report, with the score breakdown for each node so it's clear *why* each node passed or failed

**Why this is the right way to iterate:**

- No HTML, no SVG, no D3, no animations — just data in, data out. Each iteration is `node scripts/anchor-inference.js` and reads the report.
- Tuning weights and thresholds becomes a tight feedback loop. We can run dozens of variants in minutes instead of reloading the browser and squinting at the visualization.
- The validation target is explicit and measurable: match the labeled anchor set. We aren't guessing whether the result "looks right" — we're checking concrete agreement.
- We can also discover where the inference *disagrees* with the labels. If our score elevates a node that wasn't labeled as anchored, that's not necessarily a bug — it might be an interesting case where the labeler was wrong or lazy. The diff surfaces those for discussion.
- Once the inference function matches the labels (or matches with documented exceptions we agree on), only *then* do we replace the existing `place.isAnchored` logic in `anchor-data.js` with a single call to the new function. The visualization changes nothing — it just consumes a more honest signal.

This separation also makes the demo story cleaner: "I have a 50-line function that looks only at dwell, scroll, copies, and pastes. Here's the anchor set it produces. Here's the labeled set. They match." That's a much stronger claim than "look at this visualization."

### Why this is well-suited to autonomous iteration

The setup above turns anchor inference into a problem with a mechanical success criterion: the inferred set either matches the labeled set or it doesn't. That makes it one of the few tasks where letting Claude loop on the problem unattended is genuinely the right tool:

- The pass/fail signal is unambiguous (set agreement, or near-agreement with documented exceptions).
- Each iteration is cheap — no rendering, no browser, just `node script.js` and read a diff.
- The search space is well-bounded: a handful of signals, a handful of weights, a single threshold or top-K.
- There's no aesthetic judgment required mid-iteration; the user only needs to weigh in on philosophy decisions (additive vs. multiplicative, what to do about Slack) and to spot-check the final result.

The intended workflow for the next session: hand Claude the signal list and the labeled ground truth, let it propose and test scoring variants autonomously until it finds one that matches (or matches with a small, defensible set of exceptions), and then review the winning formula together. The user's role becomes "approve the philosophy and judge the final formula," not "tune the weights by hand."

## Things explicitly NOT in scope for this pass

- Changing the visualization itself (layout, colors, animation) — that's downstream
- Adding new signal types not already in the JSON
- Touching the satellite-outbound-links logic — that's orthogonal
- Tuning thresholds before validating the philosophy
