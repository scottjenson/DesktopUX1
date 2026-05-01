function normUrl(u) {
  if (!u) return u;
  if (u.indexOf('keep.google.com') !== -1) return 'KEEP';
  return u;
}

function placeLabel(url, pageTitle) {
  if (url === 'KEEP') return 'Keep';
  return shortenTitle(pageTitle);
}

function shortenTitle(s) {
  if (!s) return '';
  return s.replace(/\s*[\|\-–—]\s*[^|\-–—]+$/, '');
}

function truncate(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
