/**
 * Live model discovery.
 *
 * MODEL_CATALOG in the renderer is a hand-maintained list of Anthropic and
 * OpenAI models. It is useful as a default but wrong in two situations:
 *
 *   - a custom OpenAI-compatible endpoint (Gemini, Groq, Ollama, OpenRouter)
 *     serves models the catalog has never heard of, which is why that case fell
 *     back to a free-text box the user had to type a model id into from memory;
 *   - the catalog drifts as providers ship and retire models.
 *
 * Both SDKs expose GET /models, and every OpenAI-compatible endpoint worth
 * supporting implements it, so the honest answer is to ask the endpoint. The
 * fetched list is never persisted - it is live data, and caching it would
 * recreate the drift this exists to remove.
 *
 * Parsing and normalisation are pure and unit-tested; only fetchRemoteModels
 * touches the network.
 */

export interface RemoteModel {
  id: string
  label: string
}

/** What the two SDKs' list entries have in common, loosely typed on purpose. */
interface RawModelEntry {
  id?: unknown
  display_name?: unknown
}

/**
 * Strip a single leading `models/` segment.
 *
 * Gemini's OpenAI-compatibility layer returns ids of the form
 * `models/gemini-2.5-flash` from /models, but its chat-completions endpoint
 * expects the bare name in `model`. Passing the id straight through would
 * produce a list where every entry is rejected on use - the worst kind of
 * failure, because the id came from the provider so it looks authoritative.
 *
 * Deliberately only the exact `models/` prefix and only once: an id that
 * genuinely contains slashes (OpenRouter's `vendor/model`) must survive
 * untouched, and the free-text box remains available if this is ever wrong for
 * some endpoint.
 */
export function normalizeModelId(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed
}

/**
 * Turn a raw /models payload into pickable entries.
 *
 * Order is preserved: both APIs return newest first, which is the order a user
 * scanning for "the current model" wants. Entries without a usable string id
 * are dropped rather than rendered as blanks, and ids that collide after
 * normalisation are de-duplicated keeping the first (newest) occurrence.
 *
 * No filtering by capability. OpenAI's list includes embedding, audio and image
 * models that cannot serve a chat completion, but there is no field that says
 * so, and guessing from name substrings would silently hide models that do
 * work. The picker offers a text filter instead, which keeps the judgement with
 * the person who knows what they asked for.
 */
export function toRemoteModels(raw: unknown): RemoteModel[] {
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const out: RemoteModel[] = []

  for (const entry of raw as RawModelEntry[]) {
    if (!entry || typeof entry !== 'object') continue
    if (typeof entry.id !== 'string') continue

    const id = normalizeModelId(entry.id)
    if (!id || seen.has(id)) continue
    seen.add(id)

    const displayName =
      typeof entry.display_name === 'string' && entry.display_name.trim()
        ? entry.display_name.trim()
        : ''
    out.push({ id, label: displayName || id })
  }

  return out
}

export interface ListModelsConfig {
  provider: 'anthropic' | 'openai'
  apiKey: string
  /** Only meaningful for 'openai'; blank means api.openai.com. */
  baseUrl?: string
}

/**
 * Ask the configured endpoint what it serves.
 *
 * Runs in the main process because that is where the API key lives and where
 * there is no renderer CSP to satisfy. Errors propagate with the endpoint's own
 * message - a 401 here means the key is wrong, which is worth surfacing rather
 * than swallowing into an empty list that looks like "this endpoint has no
 * models".
 */
export async function fetchRemoteModels(config: ListModelsConfig): Promise<RemoteModel[]> {
  if (!config.apiKey) {
    throw new Error('No API key configured for this provider. Add it first.')
  }

  if (config.provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: config.apiKey })
    const page = await client.models.list({ limit: 100 })
    return toRemoteModels(page.data)
  }

  const { default: OpenAI } = await import('openai')
  const baseURL = config.baseUrl?.trim()
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(baseURL ? { baseURL } : {}),
  })
  const page = await client.models.list()
  return toRemoteModels(page.data)
}
