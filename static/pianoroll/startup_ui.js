/* Only expose the editor after both runtime and translated labels are ready. */
(function () {
  'use strict';
  var runtime = false, language = null, state = 'loading', reason = null;
  var locale = new URLSearchParams(location.search).get('hostLocale') || document.documentElement.lang || 'en';
  var zh = locale.indexOf('zh') === 0, ja = locale.indexOf('ja') === 0;
  var panel = document.getElementById('studioStartup');
  var label = document.getElementById('studioStartupLabel');
  var retry = document.getElementById('studioStartupRetry');
  label.textContent = zh ? '正在准备编曲界面…' : ja ? '編曲画面を準備しています…' : 'Preparing Studio…';
  retry.textContent = zh ? '重新加载' : ja ? '再読み込み' : 'Reload';
  retry.onclick = function () { location.reload(); };
  function notify() {
    if (window.parent !== window) window.parent.postMessage({ type: 'H2S_STUDIO_UI_STATE', version: 1, state: state, locale: language, reason: reason }, '*');
  }
  function finish() {
    if (!runtime || !language) return;
    // Readiness is a resource state, not a paint event. Background/occluded
    // frames may suspend requestAnimationFrame even when initialization is done.
    state = 'ready'; reason = null; document.documentElement.dataset.studioUiState = 'ready';
    panel.hidden = true; clearTimeout(timeout); clearTimeout(slowTimer); notify();
  }
  function fail(code) {
    if (state === 'ready') return;
    reason = typeof code === 'string' ? code : 'initialization';
    state = 'error'; document.documentElement.dataset.studioUiState = 'error';
    label.textContent = zh ? '界面或语言资源加载失败，请重试。' : ja ? '画面または言語データを読み込めませんでした。' : 'Studio or language resources could not load. Please retry.';
    retry.hidden = false; notify();
  }
  var slowTimer = setTimeout(function () {
    if (state !== 'loading') return;
    state = 'slow';
    label.textContent = zh ? '加载较慢，仍在准备编曲界面…' : ja ? '読み込みに時間がかかっています…' : 'Loading is taking longer. Still preparing Studio…';
    notify();
  }, 15000);
  var timeout = setTimeout(function () { fail('timeout'); }, 60000);
  // Resource errors are distinct from a slow connection. Never cover active work.
  window.addEventListener('error', function (event) {
    if (event.target && event.target.tagName === 'SCRIPT') fail('script');
  }, true);
  window.H2SStudioUi = {
    runtimeReady: function () { runtime = true; finish(); },
    languageReady: function (code) { language = code; finish(); },
    fail: fail, notify: notify
  };
})();
