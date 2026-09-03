/**
 * Is a transcription failure worth retrying, and what should the user be told?
 *
 * Written after a 50-second recording produced no transcript and no
 * explanation. The provider had actually said exactly what was wrong:
 *
 *   StreamingError: Unauthorized Connection: Insufficient funds
 *
 * That is a billing state, not a network blip. But the reconnect path treats
 * every error the same, so it retried five times per stream with exponential
 * backoff, across two streams, before giving up - then reported the generic
 * "All transcription providers failed after retries" and auto-stopped the
 * recording. The user saw a dead feature; the one line that explained it was in
 * a log they had no reason to open.
 *
 * Two failures here, both fixed by classifying:
 *   - retrying a permanent condition wastes the session (and, mid-call, that is
 *     the whole point of the app);
 *   - swallowing a provider's own diagnosis and replacing it with "failed" is
 *     strictly worse than repeating it verbatim.
 */

export type SttFailureKind = 'permanent' | 'transient'

export interface SttFailure {
  kind: SttFailureKind
  /** Shown to the user. Names the provider and the action that resolves it. */
  title: string
  body: string
}

/**
 * Substrings that mean "this will fail identically on every retry".
 *
 * Matched case-insensitively against the provider's message. Kept as an
 * explicit list rather than inferred from a status code because these arrive
 * over a websocket as prose - there is no status to read.
 */
const PERMANENT_MARKERS: ReadonlyArray<{ match: string; title: string; body: string }> = [
  {
    match: 'insufficient funds',
    title: 'AssemblyAI has no credit',
    body:
      'AssemblyAI refused the connection: insufficient funds. Add credit to your AssemblyAI '
      + 'account, or switch transcription to Deepgram in Settings.',
  },
  {
    match: 'payment',
    title: 'AssemblyAI billing problem',
    body:
      'AssemblyAI refused the connection for a billing reason. Check your AssemblyAI account, '
      + 'or switch transcription to Deepgram in Settings.',
  },
  {
    match: 'invalid api key',
    title: 'AssemblyAI key rejected',
    body: 'AssemblyAI rejected the API key. Re-enter it in Settings.',
  },
  {
    match: 'not authorized',
    title: 'AssemblyAI key rejected',
    body: 'AssemblyAI rejected the API key. Re-enter it in Settings.',
  },
  {
    match: 'forbidden',
    title: 'AssemblyAI access denied',
    body:
      'AssemblyAI denied access with this key. Check that streaming is enabled on your account, '
      + 'or switch transcription to Deepgram in Settings.',
  },
  {
    match: 'quota',
    title: 'AssemblyAI quota reached',
    body:
      'AssemblyAI reports the account quota is used up. Add credit, or switch transcription to '
      + 'Deepgram in Settings.',
  },
]

/**
 * 'unauthorized' is checked separately and LAST.
 *
 * AssemblyAI prefixes the funds error with "Unauthorized Connection", so a
 * naive 'unauthorized' entry above would shadow the funds match and tell the
 * user their key was bad when the key is fine and the balance is not - sending
 * them to re-enter a working key. Specific messages win; this is the fallback
 * for a bare authorization failure.
 */
const UNAUTHORIZED_FALLBACK = {
  match: 'unauthorized',
  title: 'AssemblyAI refused the connection',
  body:
    'AssemblyAI rejected the connection as unauthorized. Check the API key and the account\'s '
    + 'billing status, or switch transcription to Deepgram in Settings.',
}

export function classifySttFailure(error: unknown): SttFailure {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()

  for (const marker of PERMANENT_MARKERS) {
    if (message.includes(marker.match)) {
      return { kind: 'permanent', title: marker.title, body: marker.body }
    }
  }

  if (message.includes(UNAUTHORIZED_FALLBACK.match)) {
    return {
      kind: 'permanent',
      title: UNAUTHORIZED_FALLBACK.title,
      body: UNAUTHORIZED_FALLBACK.body,
    }
  }

  return {
    kind: 'transient',
    title: 'Transcription interrupted',
    body: 'Lost the connection to AssemblyAI. Reconnecting.',
  }
}
