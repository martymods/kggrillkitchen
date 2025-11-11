/*
 * Simple analytics client (API base aware)
 */
(function(){
  function getMeta(name){ const el=document.querySelector(`meta[name="${name}"]`); return el?el.content.trim():''; }
  const API_BASE = getMeta('kg-api-base') || '';
  function send(payload){
    try{
      fetch((API_BASE||'') + '/analytics', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...payload, timestamp:new Date().toISOString(), path:location.pathname })
      });
    }catch(e){ /* no-op */ }
  }
  function track(event, data={}){ send({ event, data }); }
  track('page_view');
  window.KGAnalytics = { track };
})();
