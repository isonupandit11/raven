import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createLogger } from '../../lib/logger'
import {
  resolveDropdownPlacement,
  availableDropdownHeight,
  type DropdownPlacement,
} from '../../lib/dropdownPlacement'
import { type AIProviderName } from '../../lib/aiModels'
import {
  ENDPOINT_PRESETS,
  resolveModelOptions,
  buildAiConfig,
  isCustomEndpoint,
  type EndpointPreset,
} from '../../lib/aiEndpoints'
import {
  clampOverlayOpacity,
  OVERLAY_OPACITY_MIN,
  OVERLAY_OPACITY_MAX,
} from '../../../../shared/overlayOpacity'

const log = createLogger('AiSettingsPopover')

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties

/**
 * A model as reported by the endpoint. Declared here rather than imported from
 * main/services/ai/modelList so the renderer does not reach across the process
 * boundary for a type; the contract is the one in global.d.ts for aiListModels.
 */
interface RemoteModel {
  id: string
  label: string
}

/**
 * Replaces a max-h-[70vh] class. A number so placement can compare it against
 * the space actually available, and so the popover becomes scrollable rather
 * than running off the screen when it cannot have its full height.
 */
const PREFERRED_POPOVER_HEIGHT = 520


/**
 * AI provider settings, reachable from the overlay.
 *
 * Everything here previously required the dashboard. Values apply on change
 * (matching how the rest of raven's settings behave) except the API key, which
 * is saved explicitly - writing a secret on every keystroke is wasteful and
 * makes a half-typed key briefly live.
 */
interface AiSettingsPopoverProps {
  /**
   * Rendered under "Overlay size". A slot rather than props because the panel's
   * geometry lives in useOverlayResize, owned by OverlayWindow - this component
   * has no business knowing panel dimensions just to display a control.
   */
  sizeControl?: React.ReactNode
}

export function AiSettingsPopover({ sizeControl }: AiSettingsPopoverProps = {}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<AIProviderName>('anthropic')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [keyStatus, setKeyStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [telemetry, setTelemetry] = useState(true)
  const [autoAnswer, setAutoAnswer] = useState(true)
  const [opacity, setOpacity] = useState(OVERLAY_OPACITY_MAX)
  const [modelListOpen, setModelListOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  // null = never fetched (so the button reads "Fetch list", not "Refresh").
  // An empty array is a real answer: the endpoint listed nothing.
  const [remoteModels, setRemoteModels] = useState<RemoteModel[] | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [placement, setPlacement] = useState<DropdownPlacement>('below')
  const [maxHeight, setMaxHeight] = useState(PREFERRED_POPOVER_HEIGHT)

  // The overlay panel is draggable, so the room under the gear is only known
  // when the popover actually opens.
  useEffect(() => {
    if (!open) return
    const measure = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const next = resolveDropdownPlacement(rect, PREFERRED_POPOVER_HEIGHT, window.innerHeight)
      setPlacement(next)
      setMaxHeight(
        Math.min(PREFERRED_POPOVER_HEIGHT, availableDropdownHeight(rect, next, window.innerHeight)),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])
  const rootRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    try {
      const [p, m, b, op] = await Promise.all([
        window.raven.storeGet('aiProvider'),
        window.raven.storeGet('aiModel'),
        window.raven.storeGet('aiBaseUrl'),
        window.raven.storeGet('overlayOpacity'),
      ])
      setProvider(p === 'openai' ? 'openai' : 'anthropic')
      setModel(typeof m === 'string' ? m : '')
      setBaseUrl(typeof b === 'string' ? b : '')
      setOpacity(clampOverlayOpacity(op))
      const auto = await window.raven.storeGet('autoAnswer')
      setAutoAnswer(typeof auto === 'boolean' ? auto : true)
    } catch (err) {
      log.error('Failed to load AI settings:', err)
    }
    try {
      setTelemetry(await window.raven.analyticsIsEnabled())
    } catch (err) {
      log.error('Failed to read telemetry state:', err)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const changeProvider = useCallback(
    async (next: AIProviderName) => {
      // buildAiConfig owns the rules: clear a base URL that only means
      // something to the openai wire format, and drop a model that belonged to
      // the endpoint being left. Shared with the dashboard so the two screens
      // cannot disagree about what a valid combination is.
      const config = buildAiConfig({ provider: next, baseUrl, model })
      setProvider(config.aiProvider)
      setBaseUrl(config.aiBaseUrl)
      setModel(config.aiModel)
      try {
        await window.raven.storeSaveMany(config)
      } catch (err) {
        log.error('Failed to save provider:', err)
      }
    },
    [baseUrl, model],
  )

  const commit = useCallback(async (patch: Record<string, unknown>) => {
    try {
      await window.raven.storeSaveMany(patch)
    } catch (err) {
      log.error('Failed to save AI settings:', err)
    }
  }, [])

  const applyPreset = useCallback(
    async (preset: EndpointPreset) => {
      const config = buildAiConfig({
        provider: 'openai',
        baseUrl: preset.url,
        model: preset.model,
      })
      setProvider(config.aiProvider)
      setBaseUrl(config.aiBaseUrl)
      setModel(config.aiModel)
      await commit(config)
    },
    [commit],
  )

  const saveKey = useCallback(async () => {
    const key = keyDraft.trim()
    if (!key) return
    setKeyStatus('saving')
    try {
      // aiKeySave writes only this provider's key. apiKeysSave would have
      // clobbered the Deepgram key, which we cannot read back to preserve.
      const ok = await window.raven.aiKeySave(provider, key)
      setKeyStatus(ok ? 'saved' : 'error')
      if (ok) setKeyDraft('')
    } catch (err) {
      log.error('Failed to save API key:', err)
      setKeyStatus('error')
    }
  }, [keyDraft, provider])

  const toggleAutoAnswer = useCallback(async () => {
    const next = !autoAnswer
    setAutoAnswer(next)
    try {
      await window.raven.storeSet('autoAnswer', next)
    } catch (err) {
      log.error('Failed to save autoAnswer:', err)
      setAutoAnswer(!next)
    }
  }, [autoAnswer])

  const toggleTelemetry = useCallback(async () => {
    const next = !telemetry
    setTelemetry(next)
    try {
      await window.raven.analyticsSetEnabled(next)
    } catch (err) {
      log.error('Failed to set telemetry:', err)
      setTelemetry(!next)
    }
  }, [telemetry])

  const changeOpacity = useCallback(async (next: number) => {
    // Optimistic so the slider tracks the thumb, then reconcile with what main
    // actually applied - the clamp differs by platform (0.99 ceiling on macOS),
    // so trusting the requested value would drift from reality.
    setOpacity(next)
    try {
      const applied = await window.raven.windowSetOverlayOpacity(next)
      if (typeof applied === 'number') setOpacity(applied)
    } catch (err) {
      log.error('Failed to set overlay opacity:', err)
    }
  }, [])

  const usingCustomEndpoint = isCustomEndpoint(provider, baseUrl)
  // Ctrl+Shift+K. Opens straight onto the model list, which is what the shortcut
  // is for - picking a model without moving the cursor into the overlay, where
  // a screen-capture viewer would watch it travel and click against apparently
  // nothing.
  useEffect(() => {
    return window.raven.onHotkeyOpenAiSettings(() => {
      setOpen((wasOpen) => {
        setModelListOpen(!wasOpen)
        return !wasOpen
      })
    })
  }, [])

  // Collapse the model list whenever the popover closes, so reopening the
  // gear never restores a dropdown the user had already dismissed.
  useEffect(() => {
    if (!open) {
      setModelListOpen(false)
      setModelFilter('')
    }
  }, [open])

  // A fetched list describes ONE provider+endpoint pair. Keeping it across a
  // switch would offer Gemini's models while Anthropic is selected, and the
  // first pick would be silently rejected on use.
  useEffect(() => {
    setRemoteModels(null)
    setModelsError('')
    setModelFilter('')
  }, [provider, baseUrl])

  // Precedence lives in aiEndpoints.resolveModelOptions, shared with the
  // dashboard, so both pickers offer the same thing.
  const modelOptions = resolveModelOptions({ provider, baseUrl, remoteModels })

  const filteredModelOptions = (() => {
    const needle = modelFilter.trim().toLowerCase()
    if (!needle) return modelOptions
    return modelOptions.filter(
      (m) =>
        m.id.toLowerCase().includes(needle) || m.label.toLowerCase().includes(needle),
    )
  })()

  // Fall back to the raw id so a model saved before a catalog change - or one
  // typed into the override box - still shows something truthful rather than an
  // empty button.
  const currentModelLabel =
    modelOptions.find((m) => m.id === model)?.label || model || 'Select a model'

  /**
   * Ask the endpoint for its model list.
   *
   * Explicit rather than automatic on open: it is a network call against the
   * user's own quota, and the gear gets opened to change unrelated things like
   * opacity. Failures are shown next to the field - a 401 here means the key is
   * wrong, which is worth reading rather than hiding behind an empty list.
   */
  const loadRemoteModels = useCallback(async () => {
    setModelsLoading(true)
    setModelsError('')
    try {
      const result = await window.raven.aiListModels()
      if (result.error) {
        setModelsError(result.error)
        return
      }
      setRemoteModels(result.models)
      if (result.models.length === 0) {
        setModelsError('The endpoint returned no models.')
      }
    } catch (err) {
      log.error('Failed to list models:', err)
      setModelsError(err instanceof Error ? err.message : 'Could not reach the endpoint.')
    } finally {
      setModelsLoading(false)
    }
  }, [])

  return (
    <div ref={rootRef} className="relative" style={NO_DRAG} data-overlay-interactive="">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="AI settings"
        className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#4169E1]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="AI settings"
          className={`absolute right-0 z-50 w-80 overflow-y-auto rounded-lg border border-white/15 bg-[#1c1b21]/95 backdrop-blur shadow-xl p-3 space-y-3 text-xs ${
            placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
          style={{ maxHeight: `${maxHeight}px` }}
        >
          <section className="space-y-1">
            <div className="text-white/40 uppercase tracking-wide text-[10px]">Provider</div>
            <div className="flex gap-1">
              {(['anthropic', 'openai'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void changeProvider(p)}
                  className={`flex-1 px-2 py-1 rounded-md border transition-colors ${
                    provider === p
                      ? 'border-[#4169E1] bg-[#4169E1]/25 text-white'
                      : 'border-white/15 text-white/70 hover:bg-white/10'
                  }`}
                >
                  {p === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}
                </button>
              ))}
            </div>
          </section>

          {provider === 'openai' ? (
            <section className="space-y-1">
              <div className="text-white/40 uppercase tracking-wide text-[10px]">Endpoint</div>
              <div className="flex flex-wrap gap-1">
                {ENDPOINT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => void applyPreset(preset)}
                    className={`px-2 py-0.5 rounded-md border transition-colors ${
                      baseUrl.trim() === preset.url
                        ? 'border-[#4169E1] bg-[#4169E1]/25 text-white'
                        : 'border-white/15 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={() => void commit({ aiBaseUrl: baseUrl.trim() })}
                placeholder="Base URL (blank = api.openai.com)"
                spellCheck={false}
                className="w-full px-2 py-1 rounded-md bg-white/5 border border-white/15 text-white placeholder-white/30 focus:outline-none focus:border-[#4169E1]"
              />
            </section>
          ) : null}

          <section className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-white/40 uppercase tracking-wide text-[10px]">Model</span>
              <button
                type="button"
                onClick={() => void loadRemoteModels()}
                disabled={modelsLoading}
                className="px-1.5 py-0.5 rounded text-[10px] text-white/50 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              >
                {modelsLoading ? 'Loading…' : remoteModels ? 'Refresh' : 'Fetch list'}
              </button>
            </div>

            {/* One listbox for both sources. On a custom endpoint this used to
                be a free-text box, because the built-in catalog only describes
                Anthropic and OpenAI models - so a Gemini or Groq user had to
                type an id from memory and found out it was wrong only when a
                request failed. Asking the endpoint for its own list removes the
                guesswork; the text box stays below as an override for an
                endpoint that does not implement GET /models. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelListOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={modelListOpen}
                disabled={modelOptions.length === 0}
                className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-white/5 border border-white/15 text-white hover:bg-white/10 disabled:opacity-50 focus:outline-none focus:border-[#4169E1] transition-colors"
              >
                <span className="truncate">{currentModelLabel}</span>
                <span className="text-white/40 shrink-0" aria-hidden="true">
                  {modelListOpen ? '▴' : '▾'}
                </span>
              </button>
              {modelListOpen ? (
                <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-md border border-white/15 bg-[#1c1b21] shadow-xl">
                  {/* A fetched list can be long - OpenAI returns embedding,
                      audio and image models alongside chat ones, and nothing in
                      the payload says which is which. Filtering by name
                      substrings here would silently hide working models, so the
                      judgement stays with the user. */}
                  {modelOptions.length > 8 ? (
                    <input
                      type="text"
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      placeholder="Filter…"
                      spellCheck={false}
                      aria-label="Filter models"
                      className="w-full px-2 py-1 rounded-t-md bg-white/5 border-b border-white/10 text-white placeholder-white/30 focus:outline-none"
                    />
                  ) : null}
                  <ul role="listbox" aria-label="Model" className="max-h-44 overflow-y-auto py-1">
                    {filteredModelOptions.length === 0 ? (
                      <li className="px-2 py-1 text-white/40">No model matches that filter.</li>
                    ) : (
                      filteredModelOptions.map((option) => (
                        <li key={option.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={option.id === model}
                            onClick={() => {
                              setModel(option.id)
                              setModelListOpen(false)
                              setModelFilter('')
                              void commit({ aiModel: option.id })
                            }}
                            className={`w-full text-left px-2 py-1 transition-colors ${
                              option.id === model
                                ? 'bg-[#4169E1]/30 text-white'
                                : 'text-white/70 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            {option.label}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ) : null}
            </div>

            {modelsError ? (
              <p className="text-[10px] text-red-300/80">{modelsError}</p>
            ) : remoteModels ? (
              <p className="text-[10px] text-white/40">
                {remoteModels.length} model{remoteModels.length === 1 ? '' : 's'} reported by the
                endpoint.
              </p>
            ) : null}

            {usingCustomEndpoint ? (
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => void commit({ aiModel: model.trim() })}
                placeholder="Or type a model id"
                spellCheck={false}
                aria-label="Model id"
                className="w-full px-2 py-1 rounded-md bg-white/5 border border-white/15 text-white placeholder-white/30 focus:outline-none focus:border-[#4169E1]"
              />
            ) : null}
          </section>

          <section className="space-y-1">
            <div className="text-white/40 uppercase tracking-wide text-[10px]">
              {provider === 'openai' ? 'OpenAI-compatible key' : 'Anthropic key'}
            </div>
            <div className="flex gap-1">
              <input
                type="password"
                value={keyDraft}
                onChange={(e) => {
                  setKeyDraft(e.target.value)
                  setKeyStatus('idle')
                }}
                placeholder="Paste key to replace"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 px-2 py-1 rounded-md bg-white/5 border border-white/15 text-white placeholder-white/30 focus:outline-none focus:border-[#4169E1]"
              />
              <button
                type="button"
                onClick={() => void saveKey()}
                disabled={!keyDraft.trim() || keyStatus === 'saving'}
                className="px-2 py-1 rounded-md border border-white/15 text-white/80 hover:bg-white/10 disabled:opacity-40 transition-colors"
              >
                {keyStatus === 'saving' ? '…' : 'Save'}
              </button>
            </div>
            <p className="text-[10px] text-white/40">
              {keyStatus === 'saved'
                ? 'Saved. Existing keys are never displayed.'
                : keyStatus === 'error'
                  ? 'Could not save the key.'
                  : 'Stored encrypted on this machine. Other keys are left untouched.'}
            </p>
          </section>

          {/* Size presets moved here from the control bar. Four buttons plus a
              mode name, two tabs, the gear and hide did not fit a narrow panel,
              and the panel is overflow-hidden, so the row silently lost
              whatever sat last. Size is set-once configuration, not something
              touched per question, so it belongs behind the gear - which lets
              the bar fit at any width without clipping anything. */}
          {sizeControl ? (
            <section className="space-y-1 pt-1 border-t border-white/10">
              <div className="text-white/40 uppercase tracking-wide text-[10px]">Overlay size</div>
              {sizeControl}
            </section>
          ) : null}

          <section className="space-y-1 pt-1 border-t border-white/10">
            <div className="flex items-center justify-between">
              <span className="text-white/40 uppercase tracking-wide text-[10px]">Opacity</span>
              <span className="text-white/60 tabular-nums">{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={OVERLAY_OPACITY_MIN}
              max={OVERLAY_OPACITY_MAX}
              step={0.05}
              value={opacity}
              onChange={(e) => void changeOpacity(Number(e.target.value))}
              aria-label="Overlay opacity"
              className="w-full accent-[#4169E1]"
            />
            <p className="text-[10px] text-white/40">
              Floors at {Math.round(OVERLAY_OPACITY_MIN * 100)}% so the overlay can never become
              invisible while still catching clicks.
            </p>
          </section>



          <section className="space-y-1 pt-1 border-t border-white/10">
            <button
              type="button"
              onClick={() => void toggleAutoAnswer()}
              className="w-full flex items-center justify-between px-1 py-1 rounded-md text-white/70 hover:bg-white/10 transition-colors"
            >
              <span>Answer their questions automatically</span>
              <span className={autoAnswer ? 'text-[#8fa8ff]' : 'text-white/40'}>
                {autoAnswer ? 'On' : 'Off'}
              </span>
            </button>
            <p className="text-[10px] text-white/40">
              Reacts only to the other party&rsquo;s speech, never your own microphone, and waits
              for a finished sentence that reads as a question.
            </p>
          </section>

          {/* Dashboard lives here, not in the tab bar. As a bare icon it sat
              immediately left of this popover's own gear, so reaching for
              settings routinely raised the full dashboard window instead -
              the opposite of what an overlay-first workflow wants. Behind a
              deliberate click, with a label, it stops being an accident. */}
          <section className="pt-1 border-t border-white/10">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                void window.raven.windowShowDashboard()
              }}
              className="w-full flex items-center justify-between px-1 py-1 rounded-md text-white/70 hover:bg-white/10 transition-colors"
            >
              <span>Open dashboard</span>
              <span className="text-white/30" aria-hidden="true">&#8599;</span>
            </button>
          </section>

          <section className="pt-1 border-t border-white/10">
            <button
              type="button"
              onClick={() => void toggleTelemetry()}
              className="w-full flex items-center justify-between px-1 py-1 rounded-md text-white/70 hover:bg-white/10 transition-colors"
            >
              <span>Anonymous usage analytics</span>
              <span className={telemetry ? 'text-[#8fa8ff]' : 'text-white/40'}>
                {telemetry ? 'On' : 'Off'}
              </span>
            </button>
          </section>
        </div>
      ) : null}
    </div>
  )
}
