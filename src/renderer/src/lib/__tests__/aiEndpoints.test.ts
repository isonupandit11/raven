import { describe, it, expect } from 'vitest'
import {
  ENDPOINT_PRESETS,
  isCustomEndpoint,
  resolveModelOptions,
  resolveModelForConfig,
  buildAiConfig,
  matchEndpointPreset,
} from '../aiEndpoints'
import { MODEL_CATALOG, DEFAULT_MODELS } from '../aiModels'

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai'

describe('isCustomEndpoint', () => {
  it('is true for a base URL under the openai provider', () => {
    expect(isCustomEndpoint('openai', GEMINI)).toBe(true)
  })

  it('is false for a blank or whitespace base URL', () => {
    expect(isCustomEndpoint('openai', '')).toBe(false)
    expect(isCustomEndpoint('openai', '   ')).toBe(false)
  })

  it('is false under anthropic even if a stale base URL is recorded', () => {
    // Anthropic does not speak the OpenAI wire format, so a base URL left over
    // from a previous provider must be ignored rather than honoured.
    expect(isCustomEndpoint('anthropic', GEMINI)).toBe(false)
  })
})

describe('resolveModelOptions', () => {
  it('prefers what the endpoint reported over the built-in catalog', () => {
    const remote = [{ id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' }]
    expect(resolveModelOptions({ provider: 'openai', baseUrl: GEMINI, remoteModels: remote })).toBe(
      remote,
    )
  })

  it('offers nothing on a custom endpoint with no fetched list', () => {
    // The catalog is not merely stale here, it describes a different provider.
    // Offering an OpenAI id for a Gemini endpoint guarantees a failed request.
    expect(
      resolveModelOptions({ provider: 'openai', baseUrl: GEMINI, remoteModels: null }),
    ).toEqual([])
  })

  it('falls back to the catalog on the default endpoint', () => {
    expect(resolveModelOptions({ provider: 'openai', baseUrl: '', remoteModels: null })).toBe(
      MODEL_CATALOG.openai,
    )
    expect(resolveModelOptions({ provider: 'anthropic', baseUrl: '', remoteModels: null })).toBe(
      MODEL_CATALOG.anthropic,
    )
  })

  it('treats an empty fetched list as no answer and falls back', () => {
    expect(
      resolveModelOptions({ provider: 'anthropic', baseUrl: '', remoteModels: [] }),
    ).toBe(MODEL_CATALOG.anthropic)
  })
})

describe('resolveModelForConfig', () => {
  it('passes a custom-endpoint model through untouched', () => {
    // THE regression this module exists for: the dashboard normalised against
    // MODEL_CATALOG, so a Gemini id was silently replaced by an OpenAI one
    // while aiBaseUrl still pointed at Google.
    expect(
      resolveModelForConfig({ provider: 'openai', baseUrl: GEMINI, model: 'gemini-2.5-flash' }),
    ).toBe('gemini-2.5-flash')
  })

  it('keeps an unusual custom id, including slashed vendor ids', () => {
    expect(
      resolveModelForConfig({
        provider: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-sonnet-5',
      }),
    ).toBe('anthropic/claude-sonnet-5')
  })

  it('keeps a catalog model on the default endpoint', () => {
    expect(
      resolveModelForConfig({ provider: 'anthropic', baseUrl: '', model: 'claude-opus-5' }),
    ).toBe('claude-opus-5')
  })

  it('falls back to the default when the id is not in the catalog', () => {
    // A stale id from a previous provider fails on every request.
    expect(
      resolveModelForConfig({ provider: 'anthropic', baseUrl: '', model: 'gpt-5.5' }),
    ).toBe(DEFAULT_MODELS.anthropic)
  })

  it('falls back for a blank model', () => {
    expect(resolveModelForConfig({ provider: 'openai', baseUrl: '', model: '' })).toBe(
      DEFAULT_MODELS.openai,
    )
  })

  it('trims whitespace', () => {
    expect(
      resolveModelForConfig({ provider: 'openai', baseUrl: GEMINI, model: '  gemini-2.5-pro  ' }),
    ).toBe('gemini-2.5-pro')
  })
})

describe('buildAiConfig', () => {
  it('keeps a Gemini setup intact', () => {
    expect(buildAiConfig({ provider: 'openai', baseUrl: GEMINI, model: 'gemini-2.5-flash' })).toEqual(
      { aiProvider: 'openai', aiBaseUrl: GEMINI, aiModel: 'gemini-2.5-flash' },
    )
  })

  it('clears the base URL when switching to anthropic', () => {
    // Leaving it recorded means switching back to openai later silently
    // resurrects an endpoint the user last used hours ago.
    expect(
      buildAiConfig({ provider: 'anthropic', baseUrl: GEMINI, model: 'claude-opus-5' }),
    ).toEqual({ aiProvider: 'anthropic', aiBaseUrl: '', aiModel: 'claude-opus-5' })
  })

  it('drops a model that belonged to the endpoint it just cleared', () => {
    expect(
      buildAiConfig({ provider: 'anthropic', baseUrl: GEMINI, model: 'gemini-2.5-flash' }),
    ).toEqual({
      aiProvider: 'anthropic',
      aiBaseUrl: '',
      aiModel: DEFAULT_MODELS.anthropic,
    })
  })

  it('always returns all three keys, so no caller can write a partial config', () => {
    const config = buildAiConfig({ provider: 'openai', baseUrl: '', model: '' })
    expect(Object.keys(config).sort()).toEqual(['aiBaseUrl', 'aiModel', 'aiProvider'])
  })
})

describe('ENDPOINT_PRESETS / matchEndpointPreset', () => {
  it('has OpenAI as the blank-url default', () => {
    expect(ENDPOINT_PRESETS[0]).toEqual({
      label: 'OpenAI',
      url: '',
      model: DEFAULT_MODELS.openai,
    })
  })

  it('every preset names a model, so choosing one never leaves it blank', () => {
    for (const preset of ENDPOINT_PRESETS) {
      expect(preset.model.trim().length).toBeGreaterThan(0)
    }
  })

  it('matches a configured base URL back to its preset', () => {
    expect(matchEndpointPreset(GEMINI)?.label).toBe('Gemini')
    expect(matchEndpointPreset('')?.label).toBe('OpenAI')
  })

  it('returns null for an endpoint that is not a preset', () => {
    expect(matchEndpointPreset('https://openrouter.ai/api/v1')).toBeNull()
  })

  it('every preset model survives resolveModelForConfig on its own endpoint', () => {
    // A preset that got normalised away would be broken the moment it was
    // picked - which is exactly what happened via the dashboard.
    for (const preset of ENDPOINT_PRESETS) {
      expect(
        resolveModelForConfig({ provider: 'openai', baseUrl: preset.url, model: preset.model }),
      ).toBe(preset.model)
    }
  })
})
