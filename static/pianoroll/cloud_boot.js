/* Download the editor while identity is checked; restore storage only after bind. */
(function (root) {
  'use strict';
  var params = new URLSearchParams(root.location.search || '');
  var waiting = params.get('cloudMode') === '1' && params.get('hostSession') === 'pending';
  var callback = null, started = false, bound = '';
  function start() {
    if (waiting || started || !callback) return;
    started = true;
    callback();
  }
  root.H2SCloudBoot = {
    run: function (fn) { callback = fn; start(); },
    bind: function (key) {
      if (!/^(anonymous|user-[A-Za-z0-9_-]+)$/.test(key || '')) return false;
      if (bound) return bound === key;
      if (!waiting) return false;
      bound = key;
      root.H2S_CLOUD_HOST_SESSION_KEY = key;
      root.H2S_CLOUD_AUTHENTICATED = key !== 'anonymous';
      waiting = false;
      start();
      return true;
    }
  };
})(window);
