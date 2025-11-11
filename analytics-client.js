/*
 * Simple analytics client for KG Grill Kitchen
 *
 * This lightweight module sends anonymous page views and events back to the
 * backend. The backend can store these in a database or forward them to
 * third‑party analytics platforms. All events are sent using the Fetch API
 * without blocking the UI. Events include a timestamp, the current page
 * location and arbitrary metadata.
 */
(function() {
  /**
   * Send a payload to the analytics endpoint. Errors are silently
   * swallowed to avoid interrupting the customer experience.
   * @param {object} payload
   */
  function send(payload) {
    try {
      fetch('/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          timestamp: new Date().toISOString(),
          path: window.location.pathname,
        }),
      });
    } catch (err) {
      console.warn('Analytics error', err);
    }
  }
  /**
   * Public track function. Pass an event name and optional data object.
   */
  function track(event, data = {}) {
    send({ event, data });
  }
  // Track a page view when the script loads
  track('page_view');
  // Expose to global
  window.KGAnalytics = { track };
})();