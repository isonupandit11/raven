function isElectronRuntime(): boolean {
  return typeof process.versions.electron === 'string'
}

/**
 * Hard deadline for a key-validation probe. Without it, a stalled network
 * (blocked/slow proxy, a silently-dropped connection, a slow TLS handshake)
 * leaves the fetch pending forever, which hangs the whole "Save & Validate" /
 * "Test Connection" flow in Settings ("it keeps on loading"). Validation is a
 * cheap auth ping, so a short deadline is safe.
 */
export const VALIDATION_TIMEOUT_MS = 10_000

/**
 * Electron's Node/undici `fetch` often throws on vendor TLS (Anthropic in
 * particular). Chromium `net.fetch` uses the same cert store as the rest of
 * the app. Tests and non-Electron callers keep using global `fetch`. Every
 * request carries an abort signal so it can never hang past the deadline.
 */
async function vendorGet(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS)
  try {
    if (isElectronRuntime()) {
      const { net } = await import('electron')
      if (typeof net?.fetch === 'function') {
        return (await net.fetch(url, { headers, signal: controller.signal })) as Response
      }
    }
    return await fetch(url, { headers, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`timed out after ${Math.round(VALIDATION_TIMEOUT_MS / 1000)}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function vendorUnreachable(name: string, err: unknown): { valid: false; error: string } {
  const detail = err instanceof Error && err.message.trim() ? err.message.trim() : 'network error'
  return { valid: false, error: `Could not reach ${name} (${detail}).` }
}

function statusFromUnknown(err: unknown): number | undefined {
  if (err != null && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status
    if (typeof status === 'number' && status > 0) return status
  }
  return undefined
}

function interpretAnthropicHttpStatus(status: number): { valid: boolean; error?: string } {
  if (status >= 200 && status < 300) return { valid: true }
  if (status === 401) return { valid: false, error: 'Invalid Anthropic API key.' }
  if (status === 403) return { valid: false, error: 'Anthropic key does not have permission. Check your plan.' }
  if (status === 429) {
    return { valid: false, error: 'Anthropic rate-limited the check. Wait a few seconds and try again.' }
  }
  return { valid: false, error: `Anthropic returned status ${status}.` }
}

/** messages.create 400/404 still mean the key was accepted (model/billing). */
function interpretAnthropicSdkStatus(status: number): { valid: boolean; error?: string } {
  if (status === 400 || status === 404) return { valid: true }
  return interpretAnthropicHttpStatus(status)
}

export async function validateDeepgramKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await vendorGet('https://api.deepgram.com/v1/projects', {
      Authorization: `Token ${apiKey}`,
    })

    if (response.ok) {
      return { valid: true }
    }

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid Deepgram API key.' }
    }

    return { valid: false, error: `Deepgram returned status ${response.status}.` }
  } catch (err) {
    return vendorUnreachable('Deepgram', err)
  }
}

export async function validateAnthropicKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  // Prefer GET /v1/models — auth only, no specific chat model required.
  // If that transport throws (common with Node fetch in Electron), fall
  // back to the official SDK. A 400/404 from messages.create is still a
  // valid key (model alias or billing), not "invalid key."
  try {
    const response = await vendorGet('https://api.anthropic.com/v1/models', {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    })

    if (response.ok) {
      return { valid: true }
    }
    return interpretAnthropicHttpStatus(response.status)
  } catch (httpErr) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      // Bound the fallback too: the SDK defaults to a 10-minute timeout with
      // retries, which would re-introduce the "keeps loading" hang here.
      const client = new Anthropic({ apiKey, timeout: VALIDATION_TIMEOUT_MS, maxRetries: 0 })
      await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return { valid: true }
    } catch (sdkErr) {
      const status = statusFromUnknown(sdkErr)
      if (status !== undefined) return interpretAnthropicSdkStatus(status)
      return vendorUnreachable('Anthropic', sdkErr instanceof Error ? sdkErr : httpErr)
    }
  }
}

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/**
 * Where to probe for an OpenAI-compatible key.
 *
 * The 'openai' provider is also how raven talks to Gemini, Groq, OpenRouter and
 * Ollama, via the aiBaseUrl setting. This validator used to hardcode
 * api.openai.com, so a perfectly good Gemini key was checked against OpenAI's
 * servers, came back 401, and Settings reported "Invalid OpenAI API key." -
 * blaming the key for being the wrong shape for an endpoint it was never going
 * to be sent to.
 *
 * /models is deliberately the same endpoint the model-list fetch uses, so
 * validating proves the exact capability the app depends on rather than a proxy
 * for it.
 */
export function openaiModelsUrl(baseUrl?: string): string {
  const base = (baseUrl || '').trim().replace(/\/+$/, '')
  return `${base || OPENAI_DEFAULT_BASE_URL}/models`
}

/** Host shown in errors, so the message names what actually refused the key. */
function endpointLabel(baseUrl?: string): string {
  const trimmed = (baseUrl || '').trim()
  if (!trimmed) return 'OpenAI'
  try {
    return new URL(trimmed).host
  } catch {
    return 'the configured endpoint'
  }
}

export async function validateOpenAIKey(
  apiKey: string,
  baseUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  const label = endpointLabel(baseUrl)
  try {
    const response = await vendorGet(openaiModelsUrl(baseUrl), {
      Authorization: `Bearer ${apiKey}`,
    })

    if (response.ok) {
      return { valid: true }
    }

    if (response.status === 401) {
      return { valid: false, error: `${label} rejected this API key.` }
    }
    if (response.status === 403) {
      return { valid: false, error: `${label} denied access with this key. Check your plan.` }
    }
    // A custom endpoint that does not implement /models answers 404. That is
    // not a bad key, and saying so would send the user to replace a working
    // one.
    if (response.status === 404) {
      return {
        valid: false,
        error: `${label} has no /models endpoint, so the key cannot be checked here. It may still work.`,
      }
    }

    return { valid: false, error: `${label} returned status ${response.status}.` }
  } catch (err) {
    return vendorUnreachable(label, err)
  }
}

/**
 * Probe the endpoint the app actually streams against.
 *
 * Previously this called GET /v2/account, which proves only that the key
 * authenticates. Streaming is separately gated: a key that passes /v2/account
 * can still be refused at the websocket with "Unauthorized Connection:
 * Insufficient funds". Onboarding therefore reported the key as valid and
 * transcription produced nothing, with no indication which of the two was
 * wrong.
 *
 * Minting a short-lived streaming token exercises the same authorisation path
 * as a real session, so a billing or entitlement problem surfaces while the
 * user is still on the key screen. It is a GET with query params, which the
 * shared vendorGet helper already covers - no SDK dependency here.
 */
const ASSEMBLYAI_STREAMING_TOKEN_URL =
  'https://streaming.assemblyai.com/v3/token?expires_in_seconds=60'

export async function validateAssemblyAIKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await vendorGet(ASSEMBLYAI_STREAMING_TOKEN_URL, {
      authorization: apiKey,
    })

    if (response.ok) {
      return { valid: true }
    }
    if (response.status === 401) {
      return { valid: false, error: 'Invalid AssemblyAI API key.' }
    }
    // Distinguished from a bad key on purpose: the key is fine and the account
    // is not. Reporting this as "invalid key" sends the user to replace a
    // working credential, which is the mistake this rewrite exists to stop.
    if (response.status === 402 || response.status === 403) {
      return {
        valid: false,
        error:
          'AssemblyAI accepted the key but refused streaming. Check the account has credit and '
          + 'streaming enabled.',
      }
    }
    // The endpoint moving is not evidence about the key. Saying so beats
    // declaring a working key invalid.
    if (response.status === 404) {
      return {
        valid: false,
        error: 'Could not reach the AssemblyAI streaming endpoint to check this key.',
      }
    }
    return { valid: false, error: `AssemblyAI returned status ${response.status}.` }
  } catch (err) {
    return vendorUnreachable('AssemblyAI', err)
  }
}

export const DEFAULT_RECALL_API_URL = 'https://ap-northeast-1.recall.ai'

export function normalizeRecallApiUrl(url: string | undefined): string {
  const trimmed = (url || DEFAULT_RECALL_API_URL).trim().replace(/\/$/, '')
  return trimmed || DEFAULT_RECALL_API_URL
}

export async function validateRecallKey(
  _apiKey: string,
  _apiUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  return { valid: false, error: 'Recall is not available.' }
}

export async function validateBothKeys(
  deepgramKey: string,
  anthropicKey: string
): Promise<{ valid: boolean; error?: string }> {
  const [deepgramResult, anthropicResult] = await Promise.all([
    validateDeepgramKey(deepgramKey),
    anthropicKey === 'skip' ? { valid: true } : validateAnthropicKey(anthropicKey)
  ])

  if (!deepgramResult.valid) {
    return deepgramResult
  }

  if (!anthropicResult.valid) {
    return anthropicResult
  }

  return { valid: true }
}

export async function validateKeys(
  deepgramKey: string,
  aiProvider: 'anthropic' | 'openai',
  aiKey: string,
  /**
   * The aiBaseUrl setting, when the provider is 'openai'. Passed in rather than
   * read here so this module stays free of store coupling and testable.
   */
  openaiBaseUrl?: string,
): Promise<{ valid: boolean; error?: string; deepgramError?: string; aiError?: string }> {
  const aiValidation = aiProvider === 'openai'
    ? validateOpenAIKey(aiKey, openaiBaseUrl)
    : validateAnthropicKey(aiKey)

  const [deepgramResult, aiResult] = await Promise.all([
    deepgramKey ? validateDeepgramKey(deepgramKey) : Promise.resolve({ valid: true as const }),
    aiValidation
  ])

  const deepgramError = deepgramResult.valid ? undefined : (deepgramResult.error || 'Invalid Deepgram key.')
  const aiError = aiResult.valid ? undefined : (aiResult.error || `Invalid ${aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'} key.`)

  if (deepgramError || aiError) {
    const invalidKeys = [
      deepgramError ? 'Deepgram' : null,
      aiError ? (aiProvider === 'openai' ? 'OpenAI' : 'Anthropic') : null,
    ].filter(Boolean)
    const error = deepgramError && aiError
      ? `Invalid ${invalidKeys.join(', ')} keys.`
      : (aiError || deepgramError) as string
    return { valid: false, error, deepgramError, aiError }
  }

  return { valid: true }
}
