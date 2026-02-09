/**
 * LLM config helper for Studio Optimize (gateway-first).
 * Node-safe: no top-level window/document/localStorage; for browser use via <script> tag.
 * localStorage key: hum2song_studio_llm_config (do not touch hum2song_studio_opt_options_by_clip).
 */
(function () {
  "use strict";

  const KEY = "hum2song_studio_llm_config";

  // PR-8D: Default safe mode ON (velocity-only)
  const DEFAULTS = { baseUrl: "", model: "", authToken: "", velocityOnly: true };

  function loadLlmConfig() {
    if (typeof localStorage === "undefined") return Object.assign({}, DEFAULTS);
    try {
      var raw = localStorage.getItem(KEY);
      if (raw == null || raw === "") return Object.assign({}, DEFAULTS);
      var parsed = JSON.parse(raw);
      // PR-8D: Merge defaults for backward compatibility (old configs without velocityOnly default to true)
      return {
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
        model: typeof parsed.model === "string" ? parsed.model : "",
        authToken: typeof parsed.authToken === "string" ? parsed.authToken : "",
        velocityOnly: typeof parsed.velocityOnly === "boolean" ? parsed.velocityOnly : true,
      };
    } catch (_) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function saveLlmConfig(config) {
    if (typeof localStorage === "undefined") return;
    if (config == null) config = {};
    var payload = {
      baseUrl: typeof config.baseUrl === "string" ? config.baseUrl : "",
      model: typeof config.model === "string" ? config.model : "",
      authToken: typeof config.authToken === "string" ? config.authToken : "",
      velocityOnly: typeof config.velocityOnly === "boolean" ? config.velocityOnly : true,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function resetLlmConfig() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(KEY);
    } catch (_) {}
  }

  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: loadLlmConfig,
    saveLlmConfig: saveLlmConfig,
    resetLlmConfig: resetLlmConfig,
  };
})();
