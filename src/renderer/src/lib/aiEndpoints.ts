/**
 * Single source of truth for AI provider / endpoint / model configuration.
 *
 * These three settings are one decision, not three:
 *
 *   aiProvider   'anthropic' | 'openai'
 *   aiBaseUrl    only meaningful for 'openai'; blank means api.openai.com
 *   aiModel      an id whose validity depends entirely on the other two
 *
 * They were being written from two places that disagreed. The overlay's
 * settings popover knew about all three and committed them together. The
 * dashboard's Models tab knew only about provider and model, and normalised the
 * model against MODEL_CATALOG - which describes Anthropic's and OpenAI's own
 * models. So configuring Gemini in the overlay and then merely opening the
 * dashboard's Models tab would rewrite aiModel to an OpenAI id while aiBaseUrl
 * still pointed at Google, and every request afterwards failed with a model the
 * user never chose.
 *
 * Both screens now go through this module, so there is one definition of what a
 * valid combination is and one way to write it.
 */

import { MODEL_CATALOG, DEFAULT_MODELS, type AIProviderName } from './aiModels'

export interface EndpointPreset {
  label: string
  /** Blank means api.openai.com (the SDK default). */
  url: string
  model: string
}

/**
 * Known OpenAI-compatible endpoints, so nobody has to remember URLs. Shared so
 * the dashboard and the overlay offer the same list.
 */
export const ENDPOINT_PRESETS: ReadonlyArray<EndpointPreset> = [
  { label: 'OpenAI', url: '', model: DEFAULT_MODELS.openai },
  {
    label: 'Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
  },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { label: 'Ollama', url: 'http://127.0.0.1:11434/v1', model: 'llama3.1' },
]

export interface ModelOption {
  id: string
  label: string
}

/**
 * Is a third-party endpoint configured?
 *
 * Only the 'openai' provider has a base URL - it owns the wire format that
 * Gemini, Groq, OpenRouter and Ollama all speak. A base URL recorded while
 * Anthropic is selected is stale and must be ignored, not honoured.
 */
export function isCustomEndpoint(provider: AIProviderName, baseUrl: string): boolean {
  return provider === 'openai' && baseUrl.trim().length > 0
}

/**
 * Which models a picker should offer.
 *
 * Precedence, and why:
 *   1. what the endpoint itself reported - it is current, the catalog is a
 *      snapshot;
 *   2. nothing, on a custom endpoint with no fetched list - the catalog is not
 *      merely stale there, it describes a different provider entirely, and
 *      offering an OpenAI id for a Gemini endpoint guarantees a failed request;
 *   3. the built-in catalog.
 */
export function resolveModelOptions(params: {
  provider: AIProviderName
  baseUrl: string
  remoteModels: ReadonlyArray<ModelOption> | null
}): ReadonlyArray<ModelOption> {
  if (params.remoteModels && params.remoteModels.length > 0) return params.remoteModels
  if (isCustomEndpoint(params.provider, params.baseUrl)) return []
  return MODEL_CATALOG[params.provider]
}

/**
 * The model id to persist for a chosen provider/endpoint.
 *
 * On a custom endpoint the user's id is authoritative and passes through
 * untouched - this is the guard the dashboard was missing. Otherwise an id
 * absent from the catalog falls back to that provider's default, because
 * sending a stale id from a previous provider fails on every request.
 */
export function resolveModelForConfig(params: {
  provider: AIProviderName
  baseUrl: string
  model: string
}): string {
  const model = params.model.trim()
  if (isCustomEndpoint(params.provider, params.baseUrl)) return model
  const known = MODEL_CATALOG[params.provider].some((m) => m.id === model)
  return known ? model : DEFAULT_MODELS[params.provider]
}

/**
 * The complete, consistent trio to write for a change to any one of them.
 *
 * Callers must persist all three together. Writing provider without clearing a
 * now-irrelevant baseUrl, or writing model without checking it belongs to the
 * endpoint, is exactly how the two screens drifted apart.
 */
export function buildAiConfig(params: {
  provider: AIProviderName
  baseUrl: string
  model: string
}): { aiProvider: AIProviderName; aiBaseUrl: string; aiModel: string } {
  // Anthropic has no base URL. Leaving a stale one recorded means switching
  // back to 'openai' silently resurrects an endpoint the user last used hours
  // ago, with whatever model they have now.
  const baseUrl = params.provider === 'openai' ? params.baseUrl.trim() : ''
  return {
    aiProvider: params.provider,
    aiBaseUrl: baseUrl,
    aiModel: resolveModelForConfig({ provider: params.provider, baseUrl, model: params.model }),
  }
}

/** The preset matching a base URL, for highlighting the active one. */
export function matchEndpointPreset(baseUrl: string): EndpointPreset | null {
  const url = baseUrl.trim()
  return ENDPOINT_PRESETS.find((p) => p.url === url) ?? null
}
