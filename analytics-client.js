/*
 * KG Grill Kitchen – analytics client
 *
 * This lightweight module sends page view and custom event data to your
 * backend's analytics endpoint. It reads the API base from the meta tag
 * `kg-api-base` (or falls back to the default KG router) and posts
 * anonymously. It does not block UI interactions if the request fails.
 */
(function() {
  // Helper to read a meta tag value
  function getMeta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.content.trim() : '';
  }

  // Determine the base URL for API calls
  let apiBase = getMeta('kg-api-base') || (typeof window !== 'undefined' && window.KG_API_BASE) || '';
  if (!apiBase) {
    // Fallback to Delco Tech's KG router
    apiBase = 'https://www.delcotechdivision.com/kg';
  }
  // Remove trailing slash for consistency
  apiBase = apiBase.replace(/\/$/, '');

  /**
   * Send a JSON payload to the analytics endpoint. Failures are ignored to
   * avoid interfering with the user experience.
   * @param {object} payload
   */
  async function send(payload) {
    try {
      await fetch(`${apiBase}/analytics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          ts: Date.now(),
          path: typeof location !== 'undefined' ? location.pathname : ''
        })
      });
    } catch (err) {
      // Ignore network errors silently
    }
  }

  // Expose a track function on the global object
  window.KGAnalytics = {
    /**
     * Track a custom event with optional data.
     * @param {string} event
     * @param {object} data
     */
    track(event, data = {}) {
      send({ event, data });
    }
  };

  // Emit a page view as soon as the script loads
  send({ event: 'page_view' });
})();