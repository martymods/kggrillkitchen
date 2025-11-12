/*
 * Simple analytics client for KG Grill Kitchen
 *
 * This lightweight module sends anonymous page views and events back to the
 * backend. The backend can store these in a database or forward them to
 * third‑party analytics platforms. All events are sent using the Fetch API
 * without blocking the UI. Events include a timestamp, the current page
 * location and arbitrary metadata.
 */
// Simple analytics client for KG Grill Kitchen. Posts events to the backend
// while respecting the configured API base. If the API base ends with /kg,
// analytics requests are sent to `${API_BASE}/analytics`. Otherwise, the
// KG router is assumed to live under /kg, and requests go to
// `${API_BASE}/kg/analytics`. This avoids CORS problems when the static site
// calls an API on a different domain.
(function() {
  function getMeta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.content.trim() : '';
  }
  let apiBase = window.KG_API_BASE || getMeta('kg-api-base') || '';
  if (typeof apiBase === 'string') {
    apiBase = apiBase.replace(/\/$/, '');
  }
  // Default to KG router on Delco Tech if no base provided
  if (!apiBase) {
    apiBase = 'https://www.delcotechdivision.com/kg';
  }
  // Decide analytics endpoint based on whether apiBase includes /kg
  let analyticsEndpoint;
  if (/\/kg$/i.test(apiBase)) {
    analyticsEndpoint = `${apiBase}/analytics`;
  } else {
    analyticsEndpoint = `${apiBase}/kg/analytics`;
  }
  function send(payload) {
    try {
      fetch(analyticsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          timestamp: new Date().toISOString(),
          path: window.location.pathname,
        }),
      });
    } catch (err) {
      // Log to console but do not throw
      console.warn('Analytics error', err);
    }
  }
  function track(event, data = {}) {
    send({ event, data });
  }
  // Track initial page view
  track('page_view');
  window.KGAnalytics = { track };
})();