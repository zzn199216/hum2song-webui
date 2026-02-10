/**
 * LLM defaults for Studio (folder/project-level defaults).
 * Browser-only script; safe to edit for deployment defaults.
 * No provider API keys here. This file is safe to edit for defaults.
 * 
 * Deployers can customize:
 * - baseUrl: default gateway endpoint (e.g., "https://your-gateway.example.com")
 * - model: optional default model name
 * - velocityOnly: safe mode default (true = ON, false = OFF)
 * - modelSuggestions: array of common model names for dropdown
 */
(function () {
  "use strict";

  globalThis.H2S_LLM_DEFAULTS = {
    baseUrl: "",              // deployers can set e.g. "https://your-gateway.example.com"
    model: "",                // optional default model
    velocityOnly: true,       // safe mode default
    modelSuggestions: [
      // Common OpenAI-style small models
      "gpt-4o-mini",
      "gpt-4.1-mini",
      // DeepSeek direct ids
      "deepseek-chat",
      "deepseek-reasoner",
      // DeepSeek via LiteLLM provider-prefixed ids (may vary by gateway config)
      "deepseek/deepseek-chat",
      "deepseek/deepseek-reasoner"
    ]
  };
})();
