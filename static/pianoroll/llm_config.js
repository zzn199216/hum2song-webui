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

  // PR-8J: Get runtime defaults (merge internal DEFAULTS with H2S_LLM_DEFAULTS if present)
  function getRuntimeDefaults() {
    var runtime = Object.assign({}, DEFAULTS);
    try {
      var extDefaults = (typeof globalThis !== "undefined" && globalThis.H2S_LLM_DEFAULTS) ? globalThis.H2S_LLM_DEFAULTS : null;
      if (extDefaults && typeof extDefaults === "object") {
        if (typeof extDefaults.baseUrl === "string") runtime.baseUrl = extDefaults.baseUrl;
        if (typeof extDefaults.model === "string") runtime.model = extDefaults.model;
        if (typeof extDefaults.velocityOnly === "boolean") runtime.velocityOnly = extDefaults.velocityOnly;
        // DO NOT take authToken from defaults (security: no secrets in defaults file)
      }
    } catch (_) {}
    return runtime;
  }

  function loadLlmConfig() {
    var runtimeDefaults = getRuntimeDefaults();
    if (typeof localStorage === "undefined") return runtimeDefaults;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw == null || raw === "") return runtimeDefaults;
      var parsed = JSON.parse(raw);
      // PR-8J: Merge runtime defaults with stored config (stored takes precedence)
      return {
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : runtimeDefaults.baseUrl,
        model: typeof parsed.model === "string" ? parsed.model : runtimeDefaults.model,
        authToken: typeof parsed.authToken === "string" ? parsed.authToken : "",
        velocityOnly: typeof parsed.velocityOnly === "boolean" ? parsed.velocityOnly : runtimeDefaults.velocityOnly,
      };
    } catch (_) {
      return runtimeDefaults;
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
    if (typeof localStorage === "undefined") return getRuntimeDefaults();
    try {
      localStorage.removeItem(KEY);
    } catch (_) {}
    return getRuntimeDefaults();
  }

  globalThis.H2S_LLM_CONFIG = {
    loadLlmConfig: loadLlmConfig,
    saveLlmConfig: saveLlmConfig,
    resetLlmConfig: resetLlmConfig,
    getRuntimeDefaults: getRuntimeDefaults,
  };
})();
