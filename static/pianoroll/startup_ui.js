/* Only expose the editor after both runtime and translated labels are ready. */
(function () {
  'use strict';
  var runtime = false, language = null, state = 'loading';
  var locale = new URLSearchParams(location.search).get('hostLocale') || document.documentElement.lang || 'en';
  var zh = locale.indexOf('zh') === 0, ja = locale.indexOf('ja') === 0;
  var panel = document.getElementById('studioStartup');
  var label = document.getElementById('studioStartupLabel');
  var retry = document.getElementById('studioStartupRetry');
  label.textContent = zh ? '正在准备编曲界面…' : ja ? '編曲画面を準備しています…' : 'Preparing Studio…';
  retry.textContent = zh ? '重新加载' : ja ? '再読み込み' : 'Reload';
  retry.onclick = function () { location.reload(); };
  function notify() {
    if (window.parent !== window) window.parent.postMessage({ type: 'H2S_STUDIO_UI_STATE', version: 1, state: state, locale: language }, '*');
  }
  function finish() {
    if (!runtime || !language) return;
    requestAnimationFrame(function () {
      state = 'ready'; document.documentElement.dataset.studioUiState = 'ready';
      panel.hidden = true; clearTimeout(timeout); notify();
    });
  }
  function fail() {
    if (state === 'ready') return;
    state = 'error'; document.documentElement.dataset.studioUiState = 'error';
    label.textContent = zh ? '界面或语言资源加载失败，请重试。' : ja ? '画面または言語データを読み込めませんでした。' : 'Studio or language resources could not load. Please retry.';
    retry.hidden = false; notify();
  }
  var timeout = setTimeout(fail, 15000);
  window.H2SStudioUi = {
    runtimeReady: function () { runtime = true; finish(); },
    languageReady: function (code) { language = code; finish(); },
    fail: fail, notify: notify
  };
})();
