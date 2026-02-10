/**
 * LLM client utility for Studio (OpenAI-compatible chat completions).
 * Browser-safe; intended for <script> tag. No top-level DOM/localStorage.
 * Exposes: extractJsonObject, callChatCompletions.
 */
(function () {
  "use strict";

  var DEFAULT_TIMEOUT_MS = 20000;

  /**
   * Extract a single JSON object from text.
   * Handles: plain JSON, ```json ...``` fenced blocks, text with leading/trailing commentary.
   * @param {string} text - Raw text that may contain JSON
   * @returns {object|null} Parsed object or null on failure
   */
  function extractJsonObject(text) {
    if (text == null || typeof text !== "string") return null;
    var s = text.trim();
    if (s === "") return null;

    try {
      var parsed = JSON.parse(s);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (_) {}

    try {
      var match = s.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match && match[1]) {
        var block = match[1].trim();
        var p = JSON.parse(block);
        if (p !== null && typeof p === "object" && !Array.isArray(p)) return p;
      }
    } catch (_) {}

    try {
      var first = s.indexOf("{");
      if (first < 0) return null;
      var depth = 0;
      var end = -1;
      for (var i = first; i < s.length; i++) {
        var ch = s[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end >= first) {
        var slice = s.slice(first, end + 1);
        var obj = JSON.parse(slice);
        if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) return obj;
      }
    } catch (_) {}

    return null;
  }

  /**
   * Normalize baseUrl for OpenAI-compatible endpoint: ensure path ends with /v1.
   * Handles baseUrl with or without trailing slash and with or without /v1.
   */
  function normalizeBaseUrl(baseUrl) {
    if (baseUrl == null || typeof baseUrl !== "string") return "";
    var u = baseUrl.trim().replace(/\/+$/, "");
    if (u === "") return "";
    if (/\/v1$/i.test(u)) return u;
    return u + "/v1";
  }

  /**
   * Call an OpenAI-compatible chat completions endpoint.
   * @param {object} cfg - { baseUrl: string, model: string, authToken?: string }
   * @param {Array} messages - Array of { role, content }
   * @param {object} [opts] - { temperature?: number, timeoutMs?: number }
   * @returns {Promise<{ text: string, raw: object }>}
   */
  function callChatCompletions(cfg, messages, opts) {
    opts = opts || {};
    var baseUrl = (cfg && typeof cfg.baseUrl === "string") ? cfg.baseUrl : "";
    var model = (cfg && typeof cfg.model === "string") ? cfg.model : "";
    if (!baseUrl || !model) {
      return Promise.reject(new Error("LLM client: baseUrl and model are required"));
    }

    var base = normalizeBaseUrl(baseUrl);
    var url = base + "/chat/completions";
    var temperature = typeof opts.temperature === "number" && opts.temperature >= 0 && opts.temperature <= 2
      ? opts.temperature
      : 0.2;
    var timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : DEFAULT_TIMEOUT_MS;

    var headers = { "Content-Type": "application/json" };
    if (cfg && typeof cfg.authToken === "string" && cfg.authToken.trim() !== "") {
      headers["Authorization"] = "Bearer " + cfg.authToken.trim();
    }

    var body = {
      model: model,
      messages: Array.isArray(messages) ? messages : [],
      temperature: temperature,
    };

    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = null;
    if (controller && typeof setTimeout !== "undefined") {
      timeoutId = setTimeout(function () {
        try { controller.abort(); } catch (_) {}
      }, timeoutMs);
    }

    var init = {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    };

    if (typeof fetch === "undefined") {
      if (timeoutId) clearTimeout(timeoutId);
      return Promise.reject(new Error("LLM client: fetch is not available"));
    }

    return fetch(url, init)
      .then(function (res) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!res.ok) throw new Error("LLM client: request failed " + res.status);
        return res.text();
      })
      .then(function (rawText) {
        var raw = null;
        try {
          raw = JSON.parse(rawText);
        } catch (_) {
          throw new Error("LLM client: invalid JSON response");
        }
        var text = "";
        if (raw && typeof raw.choices === "object" && raw.choices.length > 0) {
          var first = raw.choices[0];
          if (first && first.message && typeof first.message.content === "string") {
            text = first.message.content;
          } else if (first && typeof first.text === "string") {
            text = first.text;
          }
        }
        return { text: text, raw: raw };
      })
      .catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (err && err.name === "AbortError") {
          throw new Error("LLM client: request timeout");
        }
        throw err;
      });
  }

  /**
   * List model ids from gateway GET /v1/models (OpenAI-compatible).
   * @param {object} cfg - { baseUrl: string, authToken?: string }
   * @param {object} [opts] - { timeoutMs?: number }
   * @returns {Promise<{ ids: string[], raw?: object }>}
   */
  function listModels(cfg, opts) {
    opts = opts || {};
    var baseUrl = (cfg && typeof cfg.baseUrl === "string") ? cfg.baseUrl : "";
    if (!baseUrl || !baseUrl.trim()) {
      return Promise.reject(new Error("LLM client: baseUrl is required"));
    }
    var base = normalizeBaseUrl(baseUrl);
    var url = base + "/models";
    var timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : 8000;
    var headers = {};
    if (cfg && typeof cfg.authToken === "string" && cfg.authToken.trim() !== "") {
      headers["Authorization"] = "Bearer " + cfg.authToken.trim();
    }
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = null;
    if (controller && typeof setTimeout !== "undefined") {
      timeoutId = setTimeout(function () {
        try { controller.abort(); } catch (_) {}
      }, timeoutMs);
    }
    var init = {
      method: "GET",
      headers: headers,
      signal: controller ? controller.signal : undefined,
    };
    if (typeof fetch === "undefined") {
      if (timeoutId) clearTimeout(timeoutId);
      return Promise.reject(new Error("LLM client: fetch is not available"));
    }
    return fetch(url, init)
      .then(function (res) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!res.ok) throw new Error("LLM client: request failed " + res.status);
        return res.text();
      })
      .then(function (rawText) {
        var raw = null;
        try {
          raw = JSON.parse(rawText);
        } catch (_) {
          return { ids: [], raw: null };
        }
        var ids = [];
        if (raw && typeof raw.data === "object" && Array.isArray(raw.data)) {
          for (var i = 0; i < raw.data.length; i++) {
            var item = raw.data[i];
            if (item && typeof item.id === "string" && item.id.trim() !== "") {
              ids.push(item.id.trim());
            }
          }
        }
        return { ids: ids, raw: raw };
      })
      .catch(function (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (err && err.name === "AbortError") {
          throw new Error("LLM client: request timeout");
        }
        throw err;
      });
  }

  globalThis.H2S_LLM_CLIENT = {
    extractJsonObject: extractJsonObject,
    callChatCompletions: callChatCompletions,
    listModels: listModels,
  };
})();
