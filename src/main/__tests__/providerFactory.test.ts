import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockStoreGet } = vi.hoisted(() => ({
  mockStoreGet: vi.fn(),
}))

vi.mock('../../main/store', () => ({
  getStore: vi.fn(() => ({
    get: mockStoreGet,
  })),
  getSetting: vi.fn((key: string) => mockStoreGet(key)),
  getApiKey: vi.fn((key: string) => mockStoreGet(key, '')),
}))

vi.mock('../../main/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { getProvider, clearProviderCache, getProviderFromStore, getFastProvider, getMemoryProvider, getNotesProvider } from '../services/ai/providerFactory'
import { AnthropicProvider } from '../services/ai/anthropicProvider'
import { OpenAIProvider } from '../services/ai/openaiProvider'

describe('providerFactory', () => {
  beforeEach(() => {
    clearProviderCache()
  })

  describe('every slot honours a custom endpoint, not just live assist', () => {
    // baseUrl used to appear only in getProviderFromStore, so with Gemini
    // configured the Notes and session-memory slots built OpenAI clients
    // pointed at api.openai.com - carrying the GEMINI key, since the Gemini
    // preset stores it in openaiApiKey. A Google AIza... key sent to OpenAI
    // fails on authentication regardless of account credit, and the model id
    // came from MODEL_CATALOG, which is how "gpt-5.6-luna" ended up aimed at
    // Gemini and 404ing.
    const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai'

    const storeWith = (over: Record<string, unknown>) => {
      mockStoreGet.mockImplementation((key: string) => {
        const base: Record<string, unknown> = {
          aiProvider: 'openai',
          aiBaseUrl: GEMINI,
          aiModel: 'gemini-2.5-flash',
          openaiApiKey: 'AIzaTestKey',
        }
        return ({ ...base, ...over })[key]
      })
    }

    it('routes the notes slot to the endpoint', async () => {
      storeWith({})
      const provider = await getNotesProvider()
      expect(provider).toBeInstanceOf(OpenAIProvider)
      expect((provider as unknown as { baseUrl?: string }).baseUrl).toBe(GEMINI)
      expect((provider as unknown as { model: string }).model).toBe('gemini-2.5-flash')
    })

    it('routes the session-memory slot to the endpoint', async () => {
      storeWith({})
      const provider = await getMemoryProvider()
      expect((provider as unknown as { baseUrl?: string }).baseUrl).toBe(GEMINI)
      // Not GPT-5.6 Terra, which no third-party endpoint serves.
      expect((provider as unknown as { model: string }).model).toBe('gemini-2.5-flash')
    })

    it('routes the deprecated fast slot to the endpoint too', async () => {
      storeWith({})
      const provider = await getFastProvider()
      expect((provider as unknown as { baseUrl?: string }).baseUrl).toBe(GEMINI)
    })

    it('lets the notes slot pick its own model on the shared endpoint', async () => {
      // The flexibility the Notes card now exposes: one endpoint, per-slot model.
      storeWith({ notesModel: 'gemini-2.5-flash-lite' })
      const provider = await getNotesProvider()
      expect((provider as unknown as { model: string }).model).toBe('gemini-2.5-flash-lite')
    })

    it('ignores a notesModel left over from a first-party provider', async () => {
      // A Luna/Haiku id does not exist on Gemini, so a populated setting is not
      // the same as a usable one.
      storeWith({ notesModel: 'gpt-5.6-luna' })
      const provider = await getNotesProvider()
      expect((provider as unknown as { model: string }).model).toBe('gemini-2.5-flash')
    })

    it('does not override when no endpoint is configured', async () => {
      storeWith({ aiBaseUrl: '' })
      const provider = await getNotesProvider()
      expect((provider as unknown as { baseUrl?: string }).baseUrl).toBeUndefined()
    })

    it('does not override when the provider is anthropic', async () => {
      // A stale base URL must not resurrect an endpoint for Anthropic, which
      // does not speak the OpenAI wire format.
      storeWith({ aiProvider: 'anthropic', anthropicApiKey: 'sk-ant' })
      const provider = await getNotesProvider()
      expect(provider).toBeInstanceOf(AnthropicProvider)
    })

    it('does not override when there is no key for the endpoint', async () => {
      storeWith({ openaiApiKey: '', anthropicApiKey: 'sk-ant', notesProvider: 'anthropic' })
      const provider = await getNotesProvider()
      expect(provider).toBeInstanceOf(AnthropicProvider)
    })
  })

  describe('custom OpenAI-compatible endpoint (baseUrl)', () => {
    it('treats baseUrl as part of provider identity so switching endpoint invalidates the cache', () => {
      const a = getProvider({ provider: 'openai', model: 'gpt-5.2', apiKey: 'k' })
      expect(getProvider({ provider: 'openai', model: 'gpt-5.2', apiKey: 'k' })).toBe(a)

      const withBase = getProvider({
        provider: 'openai',
        model: 'gpt-5.2',
        apiKey: 'k',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      })

      // Before baseUrl was part of configKey this returned the cached client
      // still pointed at api.openai.com, so changing endpoint silently did
      // nothing until restart.
      expect(withBase).not.toBe(a)
    })

    it('passes a third-party model id through instead of substituting a catalog default', async () => {
      mockStoreGet.mockImplementation((key: string) => {
        switch (key) {
          case 'aiProvider': return 'openai'
          case 'aiModel': return 'gemini-2.5-flash'
          case 'aiBaseUrl': return 'https://generativelanguage.googleapis.com/v1beta/openai'
          case 'openaiApiKey': return 'k'
          default: return ''
        }
      })

      const provider = (await getProviderFromStore()) as unknown as { model: string; baseUrl?: string }

      // resolveCatalogModel() only knows OpenAI's own catalog and silently
      // falls back to DEFAULT_MODELS, which would have sent an OpenAI model
      // id to Gemini and failed.
      expect(provider).toBeInstanceOf(OpenAIProvider)
      expect(provider.model).toBe('gemini-2.5-flash')
      expect(provider.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    })

    it('still applies the OpenAI catalog when no baseUrl is set', async () => {
      mockStoreGet.mockImplementation((key: string) => {
        switch (key) {
          case 'aiProvider': return 'openai'
          case 'aiModel': return 'not-a-real-model'
          case 'aiBaseUrl': return ''
          case 'openaiApiKey': return 'k'
          default: return ''
        }
      })

      const provider = (await getProviderFromStore()) as unknown as { model: string; baseUrl?: string }

      expect(provider.model).not.toBe('not-a-real-model')
      expect(provider.baseUrl).toBeUndefined()
    })
  })

  describe('getProvider', () => {
    it('creates AnthropicProvider for anthropic config', () => {
      const provider = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: 'test-ant-placeholder',
      })

      expect(provider).toBeInstanceOf(AnthropicProvider)
      expect(provider.name).toBe('anthropic')
    })

    it('creates OpenAIProvider for openai config', () => {
      const provider = getProvider({
        provider: 'openai',
        model: 'gpt-5.2',
        apiKey: 'sk-openai-test',
      })

      expect(provider).toBeInstanceOf(OpenAIProvider)
      expect(provider.name).toBe('openai')
    })

    it('throws for unknown provider', () => {
      expect(() =>
        getProvider({
          provider: 'gemini' as any,
          model: 'gemini-pro',
          apiKey: 'key',
        })
      ).toThrow('Unknown AI provider: gemini')
    })

    it('returns cached instance for same config', () => {
      const config = {
        provider: 'anthropic' as const,
        model: 'claude-sonnet-4-6',
        apiKey: 'test-ant-placeholder',
      }

      const first = getProvider(config)
      const second = getProvider(config)

      expect(first).toBe(second)
    })

    it('creates new instance when config changes', () => {
      const first = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: 'test-ant-placeholder',
      })

      const second = getProvider({
        provider: 'openai',
        model: 'gpt-5.2',
        apiKey: 'sk-openai-test',
      })

      expect(first).not.toBe(second)
      expect(first.name).toBe('anthropic')
      expect(second.name).toBe('openai')
    })

    it('creates new instance when model changes', () => {
      const first = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: 'test-ant-placeholder',
      })

      const second = getProvider({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        apiKey: 'test-ant-placeholder',
      })

      expect(first).not.toBe(second)
    })

    it('creates new instance when effort changes', () => {
      const first = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'test-ant-placeholder',
        effort: 'low',
      })

      const second = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'test-ant-placeholder',
        effort: 'max',
      })

      expect(first).not.toBe(second)
    })
  })

  describe('clearProviderCache', () => {
    it('forces re-creation on next getProvider call', () => {
      const config = {
        provider: 'anthropic' as const,
        model: 'claude-sonnet-4-6',
        apiKey: 'test-ant-placeholder',
      }

      const first = getProvider(config)
      clearProviderCache()
      const second = getProvider(config)

      expect(first).not.toBe(second)
    })
  })

  describe('getProviderFromStore', () => {
    it('reads anthropic config including effort from store', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-sonnet-4-6',
          anthropicApiKey: 'test-ant-store-key',
        }
        return data[key] ?? defaultVal
      })

      const provider = await getProviderFromStore()

      expect(provider).toBeInstanceOf(AnthropicProvider)
      expect(provider.name).toBe('anthropic')
    })

    it('applies store aiEffort so Assist uses the Settings value', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-sonnet-5',
          aiEffort: 'max',
          anthropicApiKey: 'test-ant-store-key',
        }
        return data[key] ?? defaultVal
      })

      const fromStore = await getProviderFromStore()
      const sameEffort = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'test-ant-store-key',
        effort: 'max',
      })
      const otherEffort = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'test-ant-store-key',
        effort: 'low',
      })

      expect(fromStore).toBe(sameEffort)
      expect(fromStore).not.toBe(otherEffort)
    })

    it('does not use notesModel — live assist stays on aiModel', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-haiku-4-5',
          notesProvider: 'anthropic',
          notesModel: 'claude-sonnet-5',
          anthropicApiKey: 'test-ant-store-key',
        }
        return data[key] ?? defaultVal
      })

      const fromStore = await getProviderFromStore()
      const asAssist = getProvider({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        apiKey: 'test-ant-store-key',
        effort: 'low',
      })
      const asNotes = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'test-ant-store-key',
        effort: 'low',
      })

      expect(fromStore).toBe(asAssist)
      expect(fromStore).not.toBe(asNotes)
    })

    it('reads openai config from store and returns provider', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'openai',
          aiModel: 'gpt-5.2',
          openaiApiKey: 'sk-openai-store-key',
        }
        return data[key] ?? defaultVal
      })

      const provider = await getProviderFromStore()

      expect(provider).toBeInstanceOf(OpenAIProvider)
      expect(provider.name).toBe('openai')
    })

    it('throws when no API key is configured for anthropic', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-sonnet-4-6',
          anthropicApiKey: '',
        }
        return data[key] ?? defaultVal
      })

      await expect(getProviderFromStore()).rejects.toThrow(
        'No API key configured for anthropic. Add it in Settings.'
      )
    })

    it('throws when no API key is configured for openai', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'openai',
          aiModel: 'gpt-5.2',
          openaiApiKey: '',
        }
        return data[key] ?? defaultVal
      })

      await expect(getProviderFromStore()).rejects.toThrow(
        'No API key configured for openai. Add it in Settings.'
      )
    })
  })

  describe('getMemoryProvider', () => {
    it('returns Anthropic Sonnet 5 when Live assist is Anthropic, even if overlay is Haiku', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-haiku-4-5',
          anthropicApiKey: 'test-ant-store-key',
        }
        return data[key] ?? defaultVal
      })

      const provider = await getMemoryProvider()
      const asSonnet = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'test-ant-store-key',
        effort: 'low',
      })
      const asHaiku = getProvider({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        apiKey: 'test-ant-store-key',
        effort: 'low',
      })

      expect(provider).toBeInstanceOf(AnthropicProvider)
      expect(provider).toBe(asSonnet)
      expect(provider).not.toBe(asHaiku)
    })

    it('returns OpenAI Terra when Live assist is OpenAI, even if overlay is Luna', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'openai',
          aiModel: 'gpt-5.6-luna',
          openaiApiKey: 'sk-openai-store-key',
        }
        return data[key] ?? defaultVal
      })

      const provider = await getMemoryProvider()
      const asTerra = getProvider({
        provider: 'openai',
        model: 'gpt-5.6-terra',
        apiKey: 'sk-openai-store-key',
        effort: 'low',
      })
      const asLuna = getProvider({
        provider: 'openai',
        model: 'gpt-5.6-luna',
        apiKey: 'sk-openai-store-key',
        effort: 'low',
      })

      expect(provider).toBeInstanceOf(OpenAIProvider)
      expect(provider).toBe(asTerra)
      expect(provider).not.toBe(asLuna)
    })

    it('does not use notesModel or notesProvider — memory is not a Settings slot', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-opus-5',
          notesProvider: 'openai',
          notesModel: 'gpt-5.2',
          notesEffort: 'max',
          anthropicApiKey: 'test-ant-key',
          openaiApiKey: 'sk-openai-notes-key',
        }
        return data[key] ?? defaultVal
      })

      const memory = await getMemoryProvider()
      const asMemory = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'test-ant-key',
        effort: 'low',
      })
      const asNotes = getProvider({
        provider: 'openai',
        model: 'gpt-5.2',
        apiKey: 'sk-openai-notes-key',
        effort: 'max',
      })

      expect(memory).toBe(asMemory)
      expect(memory).not.toBe(asNotes)
    })

    it('throws when no API key is configured for the Live assist vendor', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          anthropicApiKey: '',
        }
        return data[key] ?? defaultVal
      })

      await expect(getMemoryProvider()).rejects.toThrow(
        'No API key configured for anthropic. Add it in Settings.'
      )
    })

    it('getFastProvider is an alias of getMemoryProvider', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-sonnet-4-6',
          anthropicApiKey: 'test-ant-key',
        }
        return data[key] ?? defaultVal
      })

      const memory = await getMemoryProvider()
      const fast = await getFastProvider()
      expect(fast).toBe(memory)
    })
  })

  describe('getNotesProvider', () => {
    it('falls back to FAST_MODELS when notesModel is unset, ignoring aiModel', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-sonnet-4-6',
          anthropicApiKey: 'test-ant-key',
        }
        return data[key] ?? defaultVal
      })

      clearProviderCache()
      const notesProvider = await getNotesProvider()

      clearProviderCache()
      const storeProvider = await getProviderFromStore()

      expect(notesProvider).not.toBe(storeProvider)
    })

    it('snaps a stored notes Sonnet id to Haiku', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-haiku-4-5',
          notesProvider: 'anthropic',
          notesModel: 'claude-sonnet-4-6',
          anthropicApiKey: 'test-ant-key',
        }
        return data[key] ?? defaultVal
      })

      const notes = await getNotesProvider()
      const asHaiku = getProvider({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        apiKey: 'test-ant-key',
        effort: 'low',
      })
      const asSonnet = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: 'test-ant-key',
        effort: 'low',
      })

      expect(notes).toBe(asHaiku)
      expect(notes).not.toBe(asSonnet)
    })

    it('uses notesProvider when it differs from aiProvider', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-sonnet-4-6',
          notesProvider: 'openai',
          notesModel: 'gpt-5.6-luna',
          anthropicApiKey: 'test-ant-key',
          openaiApiKey: 'sk-openai-notes-key',
        }
        return data[key] ?? defaultVal
      })

      const provider = await getNotesProvider()

      expect(provider).toBeInstanceOf(OpenAIProvider)
      expect(provider.name).toBe('openai')
    })

    it('clamps notesEffort max to low on the fast picker', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          aiModel: 'claude-haiku-4-5',
          notesProvider: 'anthropic',
          notesModel: 'claude-sonnet-5',
          notesEffort: 'max',
          anthropicApiKey: 'test-ant-key',
        }
        return data[key] ?? defaultVal
      })

      const notes = await getNotesProvider()
      const asHaikuLow = getProvider({
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        apiKey: 'test-ant-key',
        effort: 'low',
      })
      const asSonnetMax = getProvider({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        apiKey: 'test-ant-key',
        effort: 'max',
      })

      expect(notes).toBe(asHaikuLow)
      expect(notes).not.toBe(asSonnetMax)
    })

    it('throws when notesProvider is openai but no OpenAI key is configured', async () => {
      mockStoreGet.mockImplementation((key: string, defaultVal?: unknown) => {
        const data: Record<string, unknown> = {
          aiProvider: 'anthropic',
          notesProvider: 'openai',
          notesModel: 'gpt-5.6-luna',
          anthropicApiKey: 'test-ant-key',
          openaiApiKey: '',
        }
        return data[key] ?? defaultVal
      })

      await expect(getNotesProvider()).rejects.toThrow(
        'No API key configured for openai. Add it in Settings.'
      )
    })
  })
})
