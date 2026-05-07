const ANCHOR_BAND_Y = 0;
const ANCHOR_GAP_X = 280;
const VERTICAL_RANGE = 220;
const SATELLITE_RING = 95;
const MIN_ANCHOR_LABEL_PX = 60;
const MIN_ANCHOR_META_PX = 80;

function prepareAnchorData(flat) {
  const byUrl = new Map();
  flat.forEach((node, idx) => {
    const url = normUrl(node.url);
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        url,
        page_title: node.page_title,
        visits: [],
        visitIndices: [],
        totalDwell: 0,
        copyCount: 0,
        isAnchored: false,
        firstIdx: idx,
        hasCopy: false,
      });
    }
    const place = byUrl.get(url);
    place.visits.push(node);
    place.visitIndices.push(idx);
    place.totalDwell += node.active_signals.dwell_time_seconds;
    if (node.is_anchored) place.isAnchored = true;
    if (node.active_signals.clipboard_copy_event) {
      place.copyCount++;
      place.hasCopy = true;
    }
  });

  // ---- inferred pastes ----
  // TODO: revisit when JSON capture format includes explicit paste events.
  // Inference rule: each copy event lands on the next-visited Keep instance.
  // (In this dataset every copy resolves cleanly to Keep. With multiple paste
  // destinations this rule would need to be revised — better to capture pastes.)
  const pastesReceived = {};
  for (const [u] of byUrl) pastesReceived[u] = 0;

  flat.forEach((node, i) => {
    if (!node.active_signals.clipboard_copy_event) return;
    const sourceUrl = normUrl(node.url);
    for (let j = i + 1; j < flat.length; j++) {
      const candidateUrl = normUrl(flat[j].url);
      if (candidateUrl === 'KEEP' && candidateUrl !== sourceUrl) {
        pastesReceived[candidateUrl] = (pastesReceived[candidateUrl] || 0) + 1;
        break;
      }
    }
  });

  for (const [u, place] of byUrl) {
    place.pastesReceived = pastesReceived[u] || 0;
  }

  const anchors = [];
  const satellites = [];
  for (const place of byUrl.values()) {
    if (place.isAnchored) anchors.push(place);
    else satellites.push(place);
  }
  anchors.sort((a, b) => a.firstIdx - b.firstIdx);

  // score = sqrt(dwell) + 8*visits + 12*copies + 8*pastes_received
  anchors.forEach(a => {
    a.score = Math.sqrt(a.totalDwell) + 8 * a.visits.length + 12 * a.copyCount + 8 * a.pastesReceived;
  });

  // center of mass for vertical positioning
  const total = flat.length;
  anchors.forEach(a => {
    const sum = a.visitIndices.reduce((s, i) => s + i, 0);
    a.centerOfMass = sum / a.visitIndices.length / total;
  });

  return { anchors, satellites };
}

function anchorRadius(score, minScore, maxScore) {
  const minR = 28, maxR = 64;
  if (maxScore === minScore) return (minR + maxR) / 2;
  const t = (score - minScore) / (maxScore - minScore);
  return minR + Math.sqrt(t) * (maxR - minR);
}

function nodeRadius(score, minScore, maxScore) {
  const minR = 12, maxR = 40;
  if (maxScore === minScore) return (minR + maxR) / 2;
  const t = (score - minScore) / (maxScore - minScore);
  return minR + Math.sqrt(t) * (maxR - minR);
}

function nodeScore(place) {
  return Math.pow(place.totalDwell, 0.8) + 12 * (place.copyCount || 0) + 8 * (place.pastesReceived || 0);
}


function assignSatellitesToAnchors(anchors, satellites, flat) {
  const buckets = new Map(anchors.map(a => [a.url, []]));
  const anchorByUrl = new Map(anchors.map(a => [a.url, a]));

  if (flat) {
    const nodeById = new Map(flat.map(n => [n.node_id, n]));
    for (const sat of satellites) {
      let chosen = anchors[0];
      for (const idx of sat.visitIndices) {
        const node = flat[idx];
        const parent = node?.parent_node_id ? nodeById.get(node.parent_node_id) : null;
        if (parent) {
          const parentUrl = normUrl(parent.url);
          if (anchorByUrl.has(parentUrl)) { chosen = anchorByUrl.get(parentUrl); break; }
        }
      }
      if (!buckets.has(chosen.url)) buckets.set(chosen.url, []);
      buckets.get(chosen.url).push(sat);
    }
  } else {
    // Fallback: chronological
    for (const sat of satellites) {
      let chosen = anchors[0];
      for (const a of anchors) {
        if (a.firstIdx <= sat.firstIdx) chosen = a;
        else break;
      }
      buckets.get(chosen.url).push(sat);
    }
  }
  return buckets;
}

function computeAnchorEdges(flat, anchorUrls) {
  const edges = new Map();
  const byId = new Map(flat.map(n => [n.node_id, n]));
  for (const node of flat) {
    if (!node.parent_node_id) continue;
    const parent = byId.get(node.parent_node_id);
    if (!parent) continue;
    const pUrl = normUrl(parent.url);
    const cUrl = normUrl(node.url);
    if (!anchorUrls.has(pUrl) || !anchorUrls.has(cUrl)) continue;
    if (pUrl === cUrl) continue;
    const key = pUrl + '||' + cUrl;
    if (!edges.has(key)) edges.set(key, { count: 0, carrierCount: 0 });
    const rec = edges.get(key);
    rec.count++;
    if (parent.active_signals.clipboard_copy_event) rec.carrierCount++;
  }
  return edges;
}

function findInterruption(flat) {
  return flat.find(n => n.abandonment_state === 'interruption_gap');
}
