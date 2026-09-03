import { useEffect, useRef, useState } from 'react'
import { createLogger } from '../../../lib/logger'
import {
  MEMORY_MODELS,
  notesSlotIsExplicit,
  parseAIProviderName,
  resolveNotesModel,
  resolveNotesProvider,
  resolveSettingsPickerEffort,
  resolveSettingsPickerModel,
} from '../../../../../shared/aiSlots'
import {
  DEFAULT_EFFORT,
  DEFAULT_MODELS,
  EFFORT_LABELS,
  MODEL_CATALOG,
  effortLevelsForModel,
  resolveEffort,
  settingsPickerEffortLevels,
  settingsPickerModels,
  type AIProviderName,
  type EffortLevel,
  type ModelOption,
} from '../../../lib/aiModels'
import {
  isCustomEndpoint,
  resolveModelForConfig,
  buildAiConfig,
  matchEndpointPreset,
  ENDPOINT_PRESETS,
  type EndpointPreset,
} from '../../../lib/aiEndpoints'

const log = createLogger('Settings:Models')

interface SlotState {
  provider: AIProviderName
  model: string
  effort: EffortLevel
}

function catalogIds(provider: AIProviderName): string[] {
  return MODEL_CATALOG[provider].map((m) => m.id)
}

function liveSlotFromStore(
  providerRaw: unknown,
  modelRaw: unknown,
  effortRaw: unknown,
  fallbackProvider: AIProviderName,
  baseUrl: string,
): SlotState {
  const provider = (parseAIProviderName(providerRaw) ?? fallbackProvider) as AIProviderName
  // resolveModelForConfig, shared with the overlay, passes a custom-endpoint id
  // through untouched. resolveNotesModel normalises against MODEL_CATALOG,
  // which only describes Anthropic's and OpenAI's own models - so merely
  // OPENING this tab with Gemini configured turned aiModel into an OpenAI id
  // while aiBaseUrl still pointed at Google, and persistLive then wrote it
  // back. Every request afterwards used a model the user never chose.
  const model = isCustomEndpoint(provider, baseUrl)
    ? resolveModelForConfig({ provider, baseUrl, model: typeof modelRaw === 'string' ? modelRaw : '' })
    : resolveNotesModel(provider, modelRaw, catalogIds(provider))
  const effort = resolveEffort(provider, model, typeof effortRaw === 'string' ? effortRaw : undefined) ?? DEFAULT_EFFORT
  return { provider, model, effort }
}

function notesSlotFromStore(
  providerRaw: unknown,
  modelRaw: unknown,
  effortRaw: unknown,
  fallbackProvider: AIProviderName,
): SlotState {
  const provider = (parseAIProviderName(providerRaw) ?? fallbackProvider) as AIProviderName
  const model = resolveSettingsPickerModel(provider, modelRaw)
  const effort = resolveSettingsPickerEffort(effortRaw)
  return { provider, model, effort }
}

export function ModelsTab() {
  // Mirrors aiBaseUrl. Held here because the live slot's model is only
  // meaningful alongside the endpoint it belongs to.
  const [liveBaseUrl, setLiveBaseUrl] = useState('')
  // Free-text notes model, used only when a custom endpoint is configured.
  const [notesModelDraft, setNotesModelDraft] = useState('')
  // Live-slot endpoint + model, editable here as well as in the overlay. The
  // rules live in lib/aiEndpoints (shared with the overlay); only the markup
  // differs, because this screen is light-themed and the overlay is dark.
  const [baseUrlDraft, setBaseUrlDraft] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const [endpointModels, setEndpointModels] = useState<Array<{ id: string; label: string }> | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [live, setLive] = useState<SlotState>({
    provider: 'anthropic',
    model: DEFAULT_MODELS.anthropic,
    effort: DEFAULT_EFFORT,
  })
  const [notes, setNotes] = useState<SlotState>({
    provider: 'anthropic',
    model: DEFAULT_MODELS.anthropic,
    effort: DEFAULT_EFFORT,
  })
  const [notesExplicit, setNotesExplicit] = useState(false)
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false)
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle')
  const saveFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [
          aiProviderRaw,
          aiModelRaw,
          // MUST stay aligned with the Promise.all order below. Array
          // destructuring silently accepts fewer names than elements, so a
          // missing entry here would hand aiBaseUrl's value to aiEffortRaw
          // rather than failing to compile.
          aiBaseUrlRaw,
          aiEffortRaw,
          notesProviderRaw,
          notesModelRaw,
          notesEffortRaw,
          anthropicKey,
          openaiKey,
        ] = await Promise.all([
          window.raven.storeGet('aiProvider'),
          window.raven.storeGet('aiModel'),
          window.raven.storeGet('aiBaseUrl'),
          window.raven.storeGet('aiEffort'),
          window.raven.storeGet('notesProvider'),
          window.raven.storeGet('notesModel'),
          window.raven.storeGet('notesEffort'),
          window.raven.storeGet('anthropicApiKey'),
          window.raven.storeGet('openaiApiKey'),
        ])

        const liveProvider = parseAIProviderName(aiProviderRaw) ?? 'anthropic'
        const liveBase = typeof aiBaseUrlRaw === 'string' ? aiBaseUrlRaw.trim() : ''
        setLiveBaseUrl(liveBase)
        // Shown raw, not normalised: on a custom endpoint the stored id is
        // authoritative and running it through the catalog is the bug this
        // whole change exists to remove.
        setNotesModelDraft(typeof notesModelRaw === 'string' ? notesModelRaw.trim() : '')
        setBaseUrlDraft(liveBase)
        setModelDraft(typeof aiModelRaw === 'string' ? aiModelRaw.trim() : '')
        setLive(liveSlotFromStore(liveProvider, aiModelRaw, aiEffortRaw, liveProvider, liveBase))

        const explicit = notesSlotIsExplicit(notesProviderRaw, notesModelRaw)
        setNotesExplicit(explicit)
        const notesProvider = resolveNotesProvider(notesProviderRaw, liveProvider)
        setNotes(notesSlotFromStore(notesProvider, notesModelRaw, notesEffortRaw, notesProvider))

        setHasAnthropicKey(typeof anthropicKey === 'string' && anthropicKey.trim().length > 0)
        setHasOpenaiKey(typeof openaiKey === 'string' && openaiKey.trim().length > 0)
      } catch (error) {
        log.error('Failed to load model settings:', error)
      }
    }
    void load()
  }, [])

  useEffect(() => {
    return () => {
      if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    }
  }, [])

  const flashSaved = () => {
    setSaveState('saved')
    if (saveFlashRef.current) clearTimeout(saveFlashRef.current)
    saveFlashRef.current = setTimeout(() => setSaveState('idle'), 1500)
  }

  const persistLive = async (next: SlotState) => {
    // Written as one consistent trio through buildAiConfig rather than three
    // independent storeSet calls. Writing provider and model without
    // considering aiBaseUrl is how this screen and the overlay drifted apart.
    const config = buildAiConfig({
      provider: next.provider,
      baseUrl: liveBaseUrl,
      model: next.model,
    })
    await window.raven.storeSaveMany({ ...config, aiEffort: next.effort })
    setLiveBaseUrl(config.aiBaseUrl)
    flashSaved()
  }

  /**
   * Persist just the notes model id, for the custom-endpoint case.
   *
   * Deliberately does NOT set notesExplicit or touch notesProvider/notesEffort:
   * provider is dictated by the endpoint, and effort is an OpenAI/Anthropic
   * concept the endpoint may not implement. Blank clears it, which makes the
   * factory fall back to Live assist's model.
   */
  const persistNotesModel = async (raw: string) => {
    const model = raw.trim()
    setNotesModelDraft(model)
    await window.raven.storeSet('notesModel', model)
    flashSaved()
  }

  const persistNotes = async (next: SlotState) => {
    setNotesExplicit(true)
    await window.raven.storeSet('notesProvider', next.provider)
    await window.raven.storeSet('notesModel', next.model)
    await window.raven.storeSet('notesEffort', next.effort)
    flashSaved()
  }

  /**
   * Write provider + endpoint + model as one consistent trio.
   *
   * buildAiConfig owns the rules, so this screen cannot produce a combination
   * the overlay would reject - the drift that previously rewrote a Gemini model
   * to an OpenAI id just by opening this tab.
   */
  const applyEndpoint = async (nextBaseUrl: string, nextModel: string) => {
    const config = buildAiConfig({ provider: 'openai', baseUrl: nextBaseUrl, model: nextModel })
    setBaseUrlDraft(config.aiBaseUrl)
    setModelDraft(config.aiModel)
    setLiveBaseUrl(config.aiBaseUrl)
    setLive((prev) => ({ ...prev, provider: 'openai', model: config.aiModel }))
    // A fetched list belongs to one endpoint; keep it only if the endpoint did
    // not change, or the picker would offer Gemini's models for Groq.
    if (config.aiBaseUrl !== liveBaseUrl) {
      setEndpointModels(null)
      setModelsError('')
    }
    await window.raven.storeSaveMany(config)
    flashSaved()
  }

  const applyPreset = async (preset: EndpointPreset) => {
    await applyEndpoint(preset.url, preset.model)
  }

  /**
   * Ask the endpoint what it serves, same IPC the overlay uses.
   *
   * Explicit rather than automatic: it is a network call against the user's own
   * quota, and this tab gets opened to change unrelated things.
   */
  const loadEndpointModels = async () => {
    setModelsLoading(true)
    setModelsError('')
    try {
      const result = await window.raven.aiListModels()
      if (result.error) {
        setModelsError(result.error)
        return
      }
      setEndpointModels(result.models)
      if (result.models.length === 0) setModelsError('The endpoint returned no models.')
    } catch (err) {
      log.error('Failed to list models:', err)
      setModelsError(err instanceof Error ? err.message : 'Could not reach the endpoint.')
    } finally {
      setModelsLoading(false)
    }
  }

  const onLiveChange = (next: SlotState) => {
    setLive(next)
    void persistLive(next)
    if (!notesExplicit) {
      const model = DEFAULT_MODELS[next.provider]
      const effort = resolveSettingsPickerEffort(DEFAULT_EFFORT)
      setNotes({ provider: next.provider, model, effort })
    }
  }

  const hasKey = (provider: AIProviderName) =>
    provider === 'openai' ? hasOpenaiKey : hasAnthropicKey

  const missingKeyWarning = (slot: SlotState, label: string) => {
    if (hasKey(slot.provider)) return null
    const vendor = slot.provider === 'openai' ? 'OpenAI' : 'Anthropic'
    return (
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        {label} uses {vendor}, but no {vendor} key is set. Add it under API Keys.
      </p>
    )
  }

  return (
    <div className="space-y-6 max-w-lg">
      <p className="text-sm text-gray-500">
        Keys stay under API Keys. Live assist is the overlay. Notes is titles, summaries, and
        insights after a call
        {isCustomEndpoint(live.provider, liveBaseUrl)
          ? ', on the same endpoint as Live assist.'
          : ' — Haiku / Luna only.'}
      </p>

      {!hasAnthropicKey && !hasOpenaiKey && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Add an Anthropic or OpenAI key under API Keys before picking models.
        </p>
      )}

      <ModelSlotCard
        title="Live assist"
        description="Overlay Assist, What should I say, and Recap during a call."
        slot={live}
        hasAnthropicKey={hasAnthropicKey}
        hasOpenaiKey={hasOpenaiKey}
        openaiSubtitle={
          isCustomEndpoint(live.provider, liveBaseUrl)
            ? (matchEndpointPreset(liveBaseUrl)?.label ?? liveBaseUrl)
            : undefined
        }
        onChange={onLiveChange}
      />
      {missingKeyWarning(live, 'Live assist')}

      {live.provider === 'openai' ? (
        /* The endpoint picker, previously overlay-only. The 'openai' provider
           is a WIRE FORMAT, not a vendor - Gemini, Groq, OpenRouter and Ollama
           all speak it - so a screen that offers the provider without the
           endpoint is only showing half the decision. All writes go through
           buildAiConfig, shared with the overlay, so the two cannot disagree. */
        <div className="space-y-2 pt-1">
          <label className="block text-xs font-medium text-gray-500">Endpoint</label>
          <div className="flex flex-wrap gap-2">
            {ENDPOINT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => void applyPreset(preset)}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                  baseUrlDraft.trim() === preset.url
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={baseUrlDraft}
            onChange={(e) => setBaseUrlDraft(e.target.value)}
            onBlur={() => void applyEndpoint(baseUrlDraft, modelDraft)}
            placeholder="Base URL (blank = api.openai.com)"
            spellCheck={false}
            aria-label="AI base URL"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900"
          />

          {isCustomEndpoint('openai', baseUrlDraft) ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-gray-500">Model</label>
                <button
                  type="button"
                  onClick={() => void loadEndpointModels()}
                  disabled={modelsLoading}
                  className="px-2 py-0.5 text-xs rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-40 transition-colors"
                >
                  {modelsLoading ? 'Loading…' : endpointModels ? 'Refresh' : 'Fetch list'}
                </button>
              </div>
              {/* A datalist keeps this a free-text field - authoritative on a
                  custom endpoint - while still offering the fetched ids. No
                  native <select>, which would also be an unstyled OS popup. */}
              <input
                type="text"
                list="raven-endpoint-models"
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                onBlur={() => void applyEndpoint(baseUrlDraft, modelDraft)}
                placeholder="Model id, e.g. gemini-2.5-flash"
                spellCheck={false}
                aria-label="Live assist model id"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white text-gray-900"
              />
              <datalist id="raven-endpoint-models">
                {(endpointModels ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </datalist>
              {modelsError ? (
                <p className="text-xs text-red-600">{modelsError}</p>
              ) : endpointModels ? (
                <p className="text-xs text-gray-400">
                  {endpointModels.length} model{endpointModels.length === 1 ? '' : 's'} reported by
                  the endpoint.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {isCustomEndpoint(live.provider, liveBaseUrl) ? (
        /* Without this the tab silently misrepresents itself: the model picker
           lists OpenAI's catalog while requests actually go to a third-party
           endpoint, and the id in use may not appear in the list at all. Say so
           rather than letting the screen look wrong. */
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Live assist is pointed at{' '}
          <span className="font-medium">
            {matchEndpointPreset(liveBaseUrl)?.label ?? liveBaseUrl}
          </span>
          , so its model is <span className="font-medium">{live.model}</span> rather than one from
          the built-in list. Change the endpoint from the overlay&rsquo;s settings.
        </p>
      ) : null}

      {isCustomEndpoint(live.provider, liveBaseUrl) ? (
        /* On a custom endpoint the Haiku / Luna picker is not merely stale, it
           is impossible: those ids do not exist on Gemini or Groq, and the key
           in openaiApiKey belongs to that endpoint rather than to OpenAI. A
           free model id is the only honest control here, so Notes gets the same
           flexibility Live assist has - one shared endpoint, its own model. */
        <div className="pt-2 space-y-2">
          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">Notes</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Titles, summaries, and insights after a call, on the same{' '}
            <span className="font-medium">
              {matchEndpointPreset(liveBaseUrl)?.label ?? liveBaseUrl}
            </span>{' '}
            endpoint as Live assist. Leave blank to reuse Live assist&rsquo;s model.
          </p>
          <input
            type="text"
            value={notesModelDraft}
            onChange={(e) => setNotesModelDraft(e.target.value)}
            onBlur={() => void persistNotesModel(notesModelDraft)}
            placeholder={live.model || 'Model id'}
            spellCheck={false}
            aria-label="Notes model id"
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          />
        </div>
      ) : (
        <>
          <ModelSlotCard
            title="Notes"
            description="Titles, summaries, and insights after a call. Fast models only (Haiku / Luna)."
            slot={notes}
            fastOnly
            hasAnthropicKey={hasAnthropicKey}
            hasOpenaiKey={hasOpenaiKey}
            onChange={(next) => {
              setNotes(next)
              void persistNotes(next)
            }}
          />
          {missingKeyWarning(notes, 'Notes')}
        </>
      )}

      <div className="pt-2 space-y-2">
        <h4 className="text-sm font-medium text-gray-900">Session memory</h4>
        <p className="text-xs text-gray-400">
          Not configurable. Compacts the overlay thread in the background so Assist does not drop the original task.
          Uses a stronger model on the same key as Live assist, not the cheap notes default.
        </p>
        <p className="px-3 py-2.5 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg">
          {/* getMemoryProvider now routes through the custom endpoint, so
              naming GPT-5.6 Terra here would state a model that is never used.
              On a custom endpoint memory runs Live assist's model, because no
              third-party endpoint serves our first-party "stronger" ids. */}
          {isCustomEndpoint(live.provider, liveBaseUrl)
            ? live.model
            : MODEL_CATALOG[live.provider].find((m) => m.id === MEMORY_MODELS[live.provider])?.label
              ?? MEMORY_MODELS[live.provider]}
          <span className="block text-[11px] text-gray-400 mt-0.5">
            {isCustomEndpoint(live.provider, liveBaseUrl)
              ? `${matchEndpointPreset(liveBaseUrl)?.label ?? liveBaseUrl} key · same model as Live assist`
              : `${live.provider === 'openai' ? 'OpenAI key' : 'Anthropic key'} · system default`}
          </span>
        </p>
      </div>

      {saveState === 'saved' && (
        <p className="text-xs text-green-700">Saved</p>
      )}
    </div>
  )
}

function ModelSlotCard({
  title,
  description,
  slot,
  fastOnly = false,
  hasAnthropicKey,
  hasOpenaiKey,
  openaiSubtitle,
  onChange,
}: {
  title: string
  description: string
  slot: SlotState
  fastOnly?: boolean
  hasAnthropicKey: boolean
  hasOpenaiKey: boolean
  /** Overrides "GPT models" when requests actually go to a third-party endpoint. */
  openaiSubtitle?: string
  onChange: (next: SlotState) => void
}) {
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const modelRef = useRef<HTMLDivElement>(null)
  const effortRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!modelOpen && !effortOpen) return
    const handleClick = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false)
      if (effortRef.current && !effortRef.current.contains(e.target as Node)) setEffortOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [modelOpen, effortOpen])

  const modelOptions: ModelOption[] = fastOnly
    ? settingsPickerModels(slot.provider)
    : MODEL_CATALOG[slot.provider]
  const effortLevels = fastOnly
    ? settingsPickerEffortLevels(slot.provider, slot.model)
    : effortLevelsForModel(slot.provider, slot.model)
  const selectedModelLabel = modelOptions.find((m) => m.id === slot.model)?.label || slot.model

  const applyProvider = (provider: AIProviderName) => {
    const allowed = provider === 'openai' ? hasOpenaiKey : hasAnthropicKey
    if (!allowed) return
    const model = DEFAULT_MODELS[provider]
    const effort = fastOnly
      ? resolveSettingsPickerEffort(slot.effort)
      : (resolveEffort(provider, model, slot.effort) ?? DEFAULT_EFFORT)
    onChange({ provider, model, effort })
  }

  const applyModel = (modelId: string) => {
    const effort = fastOnly
      ? resolveSettingsPickerEffort(slot.effort)
      : (resolveEffort(slot.provider, modelId, slot.effort) ?? DEFAULT_EFFORT)
    onChange({ ...slot, model: modelId, effort })
  }

  const effortHint = (opt: ModelOption) => {
    const levels = fastOnly
      ? settingsPickerEffortLevels(slot.provider, opt.id)
      : opt.effort
    return levels ? `Effort: ${levels.join(', ')}` : 'No effort setting'
  }

  const providerBtn = (provider: AIProviderName, label: string, sub: string) => {
    const allowed = provider === 'openai' ? hasOpenaiKey : hasAnthropicKey
    const selected = slot.provider === provider
    return (
      <button
        type="button"
        disabled={!allowed}
        onClick={() => applyProvider(provider)}
        className={`flex-1 px-4 py-3 rounded-lg border text-sm font-medium text-left transition-colors ${
          selected
            ? 'border-blue-500 bg-blue-50 text-blue-700'
            : allowed
              ? 'border-gray-200 text-gray-600 hover:bg-gray-50'
              : 'border-gray-100 text-gray-300 cursor-not-allowed bg-gray-50'
        }`}
      >
        <div className="font-medium">{label}</div>
        <div className="text-xs mt-0.5 opacity-70">{allowed ? sub : 'Add key under API Keys'}</div>
      </button>
    )
  }

  return (
    <div className="pt-4 first:pt-0 space-y-4">
      <div>
        <h4 className="text-sm font-medium text-gray-900">{title}</h4>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>

      <div className="flex gap-3">
        {providerBtn('anthropic', 'Anthropic', 'Claude models')}
        {/* "GPT models" is false when an OpenAI-compatible endpoint is
            configured: the provider is the wire format, not the vendor, and
            requests go wherever aiBaseUrl points. */}
        {providerBtn('openai', 'OpenAI', openaiSubtitle ?? 'GPT models')}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">Model</label>
        <div className="relative" ref={modelRef}>
          <button
            type="button"
            onClick={() => { setModelOpen(!modelOpen); setEffortOpen(false) }}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-left hover:border-gray-400 transition-colors"
          >
            <span className="truncate">{selectedModelLabel}</span>
            <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 ml-2 transition-transform ${modelOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {modelOpen && (
            <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-56 overflow-y-auto">
              {modelOptions.map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => { applyModel(opt.id); setModelOpen(false) }}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-gray-50 ${
                    opt.id === slot.model ? 'text-blue-600 bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{opt.label}</span>
                    <span className={`block truncate text-[11px] ${opt.id === slot.model ? 'text-blue-500' : 'text-gray-400'}`}>
                      {effortHint(opt)}
                    </span>
                  </span>
                  {opt.id === slot.model && (
                    <svg className="w-4 h-4 text-blue-600 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">
          Effort for {selectedModelLabel}
        </label>
        {effortLevels ? (
          <div className="relative" ref={effortRef}>
            <button
              type="button"
              onClick={() => { setEffortOpen(!effortOpen); setModelOpen(false) }}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-left hover:border-gray-400 transition-colors"
            >
              <span className="truncate">
                {effortLevels.includes(slot.effort) ? (EFFORT_LABELS[slot.effort] || slot.effort) : (EFFORT_LABELS[effortLevels[0]])}
              </span>
              <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 ml-2 transition-transform ${effortOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {effortOpen && (
              <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-56 overflow-y-auto">
                {effortLevels.map((level) => (
                  <button
                    type="button"
                    key={level}
                    onClick={() => { onChange({ ...slot, effort: level }); setEffortOpen(false) }}
                    className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-gray-50 ${
                      level === slot.effort ? 'text-blue-600 bg-blue-50' : 'text-gray-700'
                    }`}
                  >
                    <span className="truncate">{EFFORT_LABELS[level]}</span>
                    {level === slot.effort && (
                      <svg className="w-4 h-4 text-blue-600 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="px-3 py-2.5 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg">
            This model has no effort parameter.
          </p>
        )}
        {effortLevels && (
          <p className="text-xs text-gray-400">
            {fastOnly
              ? 'Fast settings only. Session memory and Live assist are not affected.'
              : 'Only the levels this model accepts. Higher is slower and more thorough.'}
          </p>
        )}
      </div>
    </div>
  )
}
