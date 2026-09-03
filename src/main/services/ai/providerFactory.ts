import type { AIProvider, AIProviderConfig, AIProviderName } from './types';
import { DEFAULT_EFFORT, resolveCatalogModel, PROVIDER_MODELS } from './types';
import { AnthropicProvider } from './anthropicProvider';
import { OpenAIProvider } from './openaiProvider';
import { createLogger } from '../../logger';
import {
  NOTES_FAST_MODELS,
  resolveMemoryModel,
  resolveMemoryProvider,
  resolveNotesProvider,
  resolveSettingsPickerEffort,
  resolveSettingsPickerModel,
} from '../../../shared/aiSlots';

const log = createLogger('AI');

let cachedProvider: AIProvider | null = null;
let cachedConfigKey = '';

function configKey(config: AIProviderConfig): string {
  // baseUrl is part of the identity: without it, switching endpoint (e.g.
  // OpenAI -> Gemini) while provider/model/key are unchanged would return the
  // cached client still pointed at the old host, and the change would appear
  // to do nothing until restart.
  return `${config.provider}:${config.model}:${config.effort ?? ''}:${config.apiKey}:${config.baseUrl ?? ''}`;
}

export function getProvider(config: AIProviderConfig): AIProvider {
  const key = configKey(config);
  if (cachedProvider && cachedConfigKey === key) {
    return cachedProvider;
  }

  switch (config.provider) {
    case 'anthropic':
      cachedProvider = new AnthropicProvider(config.apiKey, config.model, config.effort);
      break;
    case 'openai':
      cachedProvider = new OpenAIProvider(config.apiKey, config.model, config.effort, config.baseUrl);
      break;
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }

  cachedConfigKey = key;
  // The endpoint belongs in this line. Without it, "Created openai provider
  // with model gpt-5.6-luna" reads as an ordinary OpenAI request, when the
  // model was actually being sent to Gemini and 404ing - the one fact needed to
  // diagnose it was the one fact not logged. Host only: a base URL can carry a
  // key in a query string on some gateways.
  let endpoint = 'api.openai.com';
  if (config.baseUrl) {
    try {
      endpoint = new URL(config.baseUrl).host;
    } catch {
      endpoint = 'invalid base URL';
    }
  }
  log.info(
    `Created ${config.provider} provider with model ${config.model} effort ${config.effort ?? 'default'}`
    + (config.provider === 'openai' ? ` endpoint ${endpoint}` : ''),
  );
  return cachedProvider;
}

export function clearProviderCache(): void {
  cachedProvider = null;
  cachedConfigKey = '';
}

/** Cheap notes fallback (Haiku / Luna). Memory uses MEMORY_MODELS, not this. */
export const FAST_MODELS: Record<AIProviderName, string> = NOTES_FAST_MODELS;

function requireApiKey(
  provider: AIProviderName,
  getApiKey: (key: 'openaiApiKey' | 'anthropicApiKey') => string,
): string {
  const apiKey = provider === 'openai'
    ? getApiKey('openaiApiKey')
    : getApiKey('anthropicApiKey');
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider}. Add it in Settings.`);
  }
  return apiKey;
}

/**
 * The custom-endpoint override, or null when running against a first-party API.
 *
 * Every factory below has to consult this, not just live assist. When an
 * OpenAI-compatible endpoint is configured:
 *
 *   - the KEY in openaiApiKey belongs to THAT endpoint. With the Gemini preset
 *     it is a Google AIza... key, so any request built without the base URL
 *     sends a Google key to api.openai.com and fails on authentication no
 *     matter how much credit the account has.
 *   - the MODEL cannot come from MODEL_CATALOG. There is no way to know a
 *     third-party endpoint's equivalent of "GPT-5.6 Luna", and resolving
 *     against the catalog is exactly how "Created openai provider with model
 *     gpt-5.6-luna" ended up pointed at Gemini and 404ing.
 *
 * So on a custom endpoint the notes and session-memory slots reuse aiModel -
 * the one model the user has actually confirmed works there. That gives up the
 * cheap-fast-model optimisation those slots exist for, which is the right
 * trade: a slightly more expensive call beats a guaranteed failure, and we have
 * no basis for guessing a cheaper id.
 */
/**
 * Is this id one of OUR first-party catalog ids?
 *
 * Used to reject a slot model left over from Anthropic or OpenAI. A Haiku or
 * Luna id does not exist on Gemini or Groq, so it must not be used on a custom
 * endpoint merely because the setting is populated - which is how a stale
 * catalog id reached a third-party endpoint and 404'd in the first place.
 */
function isCatalogModelId(model: string): boolean {
  return PROVIDER_MODELS.anthropic.includes(model) || PROVIDER_MODELS.openai.includes(model);
}

async function customEndpointOverride(
  /**
   * Which stored model id this slot should prefer. The endpoint is shared - one
   * aiBaseUrl - but the MODEL is per slot, so Notes can run something cheap on
   * the same endpoint while live assist runs something stronger. Falls back to
   * aiModel, the one id the user has confirmed works there.
   */
  modelKey: 'aiModel' | 'notesModel' = 'aiModel',
): Promise<{ provider: 'openai'; model: string; apiKey: string; baseUrl: string } | null> {
  const { getSetting, getApiKey } = await import('../../store');
  if ((getSetting('aiProvider') || 'anthropic') !== 'openai') return null;
  const baseUrl = ((getSetting('aiBaseUrl') as string) || '').trim();
  if (!baseUrl) return null;

  const preferred = ((getSetting(modelKey) as string) || '').trim();
  // A notesModel left over from a first-party provider (a Haiku or Luna id)
  // does not exist on this endpoint, so it must not be used just because it is
  // set. Only an id absent from the catalog can have been chosen FOR this
  // endpoint.
  const usable = preferred && !isCatalogModelId(preferred) ? preferred : '';
  const model = usable || ((getSetting('aiModel') as string) || '').trim();
  if (!model) return null;

  const apiKey = getApiKey('openaiApiKey');
  if (!apiKey) return null;

  return { provider: 'openai', model, apiKey, baseUrl };
}

/** Live assist: overlay Assist / What should I say / Recap. */
export async function getProviderFromStore(): Promise<AIProvider> {
  const { getSetting, getApiKey } = await import('../../store');

  const provider = (getSetting('aiProvider') || 'anthropic') as AIProviderName;
  // Custom OpenAI-compatible endpoint (Gemini, Groq, OpenRouter, Ollama...).
  // Only meaningful for the 'openai' provider, which owns the wire format.
  const baseUrl = provider === 'openai'
    ? ((getSetting('aiBaseUrl') as string) || '').trim()
    : '';
  // MODEL_CATALOG describes OpenAI's own models, and resolveCatalogModel()
  // silently substitutes DEFAULT_MODELS when the id isn't in it - so a
  // third-party id like 'gemini-2.5-flash' would be swapped for an OpenAI
  // model and the endpoint would reject it. On a custom endpoint the user's
  // model id is authoritative; pass it through untouched.
  const requestedModel = (getSetting('aiModel') as string) || '';
  const model = baseUrl
    ? requestedModel.trim()
    : resolveCatalogModel(provider, requestedModel);
  const effort = (getSetting('aiEffort') as string) || DEFAULT_EFFORT;
  const apiKey = requireApiKey(provider, getApiKey);

  return getProvider({ provider, model, apiKey, effort, baseUrl: baseUrl || undefined });
}

/** Notes slot: title, summary, insights. Not used for overlay Assist or session memory. */
export async function getNotesProvider(): Promise<AIProvider> {
  // A custom endpoint overrides the Notes slot entirely. The Settings picker
  // offers Haiku / Luna, which do not exist on Gemini or Groq, and its key
  // would be the wrong vendor's anyway.
  const override = await customEndpointOverride('notesModel');
  if (override) return getProvider({ ...override, effort: undefined });

  const { getSetting, getApiKey } = await import('../../store');

  const provider = resolveNotesProvider(getSetting('notesProvider'), getSetting('aiProvider'));
  const model = resolveSettingsPickerModel(provider, getSetting('notesModel'));
  const effort = resolveSettingsPickerEffort(getSetting('notesEffort'));
  const apiKey = requireApiKey(provider, getApiKey);

  return getProvider({ provider, model, apiKey, effort });
}

/**
 * Session memory compact. Not a Settings slot.
 * Same vendor as Live assist: Sonnet 5 (Anthropic) or GPT-5.6 Terra (OpenAI).
 */
export async function getMemoryProvider(): Promise<AIProvider> {
  // Same reasoning as the notes slot: GPT-5.6 Terra is not a model any
  // third-party endpoint serves.
  const override = await customEndpointOverride();
  if (override) return getProvider({ ...override, effort: DEFAULT_EFFORT });

  const { getSetting, getApiKey } = await import('../../store');

  const provider = resolveMemoryProvider(getSetting('aiProvider'));
  const model = resolveMemoryModel(getSetting('aiProvider'));
  const apiKey = requireApiKey(provider, getApiKey);

  return getProvider({ provider, model, apiKey, effort: DEFAULT_EFFORT });
}

/** @deprecated Use getMemoryProvider. Kept so older callers keep the cheap system model. */
export async function getFastProvider(): Promise<AIProvider> {
  return getMemoryProvider();
}
