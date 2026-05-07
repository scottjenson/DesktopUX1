window.HISTORY_DATA = [];

fetch('./history2.json')
  .then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then(data => {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid data format');
    }
    window.HISTORY_DATA = data;
    // Trigger initialization callback if waiting
    if (typeof window._dataReadyCallback === 'function') {
      window._dataReadyCallback();
    }
  })
  .catch(err => {
    console.error('Failed to load history data:', err);
    const nodeCount = document.getElementById('node-count');
    if (nodeCount) {
      nodeCount.textContent = 'error loading data: ' + err.message;
    }
  });
