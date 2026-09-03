/**
 * AssemblyAI Transcription Service (v3 Streaming API).
 *
 * Creates two StreamingTranscriber instances - one for mic, one for system
 * audio - authenticating with the user's own key. Falls back to Deepgram on
 * failure (handled by AudioManager).
 *
 * MIGRATED FROM v2. This used RealtimeTranscriber and minted a temporary token
 * via client.realtime.createTemporaryToken(), which POSTs /v2/realtime/token -
 * an endpoint AssemblyAI has retired. Newer accounts get 404 Not found there
 * (note: not 401, so it was never a bad-key problem), the token step returned
 * null, and start() bailed straight to the Deepgram fallback - which then found
 * no Deepgram key and stopped transcription entirely. Symptom: a recording that
 * captured audio fine and produced no transcript at all.
 *
 * The token subsystem is gone rather than ported. Temporary tokens exist so a
 * BROWSER can connect without shipping the API key to the client; this service
 * runs in the main process, where the key already lives, so
 * StreamingTranscriberParams.apiKey connects directly. That removes the 480s
 * token TTL, the refresh timer, the mid-session reconnect-with-new-token dance,
 * and the second-token round trip the dual-stream setup needed - four moving
 * parts whose only purpose was working around a constraint that does not apply
 * here.
 */

import { BrowserWindow } from 'electron'
import { StreamingTranscriber, AssemblyAI } from 'assemblyai'
import { createLogger } from '../logger'
import { getApiKey, getSetting } from '../store'
import { sessionManager } from './sessionManager'
import { AUDIO_SAMPLE_RATE, TRANSCRIPT_MERGE_WINDOW_MS } from '../constants'
import { resolveTurnAction, flushPendingTurn, type PendingTurn } from './assemblyaiTurns'
import { classifySttFailure } from './sttFailure'

const log = createLogger('AssemblyAI')

const MAX_RECONNECT_ATTEMPTS = 5
const MAX_TRANSCRIPT_ENTRIES = 5000

type AudioSource = 'mic' | 'system'

interface TranscriptEntry {
  id: string
  source: AudioSource
  text: string
  speaker: 'you' | 'them'
  timestamp: number
  isFinal: boolean
}

interface TranscriberState {
  transcriber: StreamingTranscriber | null
  isConnected: boolean
  currentInterim: string
  reconnectAttempts: number
  reconnecting: boolean
  /**
   * An unformatted end-of-turn held until its formatted version arrives. See
   * assemblyaiTurns.ts - finalizing both copies would duplicate the sentence,
   * because handleFinalTranscript merges consecutive same-speaker entries.
   */
  pendingTurn: PendingTurn | null
}

export class AssemblyAITranscriptionService {
  private micState: TranscriberState = { transcriber: null, isConnected: false, currentInterim: '', reconnectAttempts: 0, reconnecting: false, pendingTurn: null }
  private systemState: TranscriberState = { transcriber: null, isConnected: false, currentInterim: '', reconnectAttempts: 0, reconnecting: false, pendingTurn: null }
  private overlayWindow: BrowserWindow | null = null
  private dashboardWindow: BrowserWindow | null = null
  private transcriptEntries: TranscriptEntry[] = []
  private isActive = false
  private aborting = false
  private permanentFailure: ReturnType<typeof classifySttFailure> | null = null
  private onFallback: (() => Promise<void>) | null = null

  setWindows(dashboard: BrowserWindow | null, overlay: BrowserWindow | null): void {
    this.dashboardWindow = dashboard
    this.overlayWindow = overlay
  }

  setFallbackHandler(handler: () => Promise<void>): void {
    this.onFallback = handler
  }

  async start(): Promise<{ success: boolean; error?: string; fallback?: boolean }> {
    const apiKey = getApiKey('assemblyaiApiKey')
    if (!apiKey) {
      log.warn('No AssemblyAI API key in store - triggering fallback')
      return { success: false, fallback: true, error: 'No AssemblyAI API key configured' }
    }

    log.info('Starting AssemblyAI transcription (v3 streaming)...')
    this.isActive = true
    this.permanentFailure = null

    // Both streams authenticate with the same key. Under v2 each connection
    // needed its own single-use temporary token, so the system stream had to
    // fetch a second one and could fail independently of the mic; with a direct
    // key there is nothing to run out of.
    // Speech-model selection for the Recall path lives in
    // transcriptProviderRouting; this native-capture path uses AssemblyAI's
    // default streaming model.
    const [micResult, systemResult] = await Promise.all([
      this.startTranscriber('mic', apiKey),
      this.startTranscriber('system', apiKey),
    ])

    if (!micResult.success && !systemResult.success) {
      this.isActive = false
      log.error('Both AssemblyAI connections failed - triggering fallback')
      return { success: false, fallback: true, error: 'Failed to connect to AssemblyAI' }
    }

    log.info(`AssemblyAI started - Mic: ${micResult.success}, System: ${systemResult.success}`)
    return { success: true }
  }

  private async startTranscriber(
    source: AudioSource,
    apiKey: string,
  ): Promise<{ success: boolean }> {
    const state = source === 'mic' ? this.micState : this.systemState

    try {
      // Built through the client's factory rather than `new StreamingTranscriber`
      // so the SDK owns the websocket base URL - it points at
      // streaming.assemblyai.com/v3/ws, which is the whole reason this service
      // was rewritten.
      const client = new AssemblyAI({ apiKey })
      state.pendingTurn = null
      state.transcriber = client.streaming.transcriber({
        apiKey,
        sampleRate: AUDIO_SAMPLE_RATE,
        encoding: 'pcm_s16le',
        // Punctuated, cased output. This makes each turn end twice (once raw,
        // once formatted), which resolveTurnAction exists to disentangle.
        formatTurns: true,
      })

      state.transcriber.on('turn', (event) => {
        const decision = resolveTurnAction(event, state.pendingTurn)
        state.pendingTurn = decision.pending
        for (const finalText of decision.finalize) {
          this.handleFinalTranscript(finalText, source)
        }
        // '' is meaningful - it clears a stale interim once a turn is final -
        // so only null means "leave the interim alone".
        if (decision.partial !== null) {
          this.handlePartialTranscript(decision.partial, source)
        }
      })

      state.transcriber.on('error', (err) => {
        log.error(`[${source.toUpperCase()}] AssemblyAI error:`, err)
        // A permanent condition - no credit, rejected key, quota - fails
        // identically on every retry. Reconnecting through it burned 50 seconds
        // across two streams and then reported a generic "all providers
        // failed", so the provider's own diagnosis never reached the user.
        const failure = classifySttFailure(err)
        if (failure.kind === 'permanent') {
          log.error(`[${source.toUpperCase()}] Permanent failure - not retrying: ${failure.title}`)
          this.permanentFailure = failure
          void this.abortToFallback()
          return
        }
        if (this.isActive) {
          this.handleDisconnect(source)
        }
      })

      state.transcriber.on('close', (_code: number, _reason: string) => {
        log.warn(`[${source.toUpperCase()}] AssemblyAI closed`)
        state.isConnected = false
        // Without this the last sentence of a session is lost every time the
        // connection closes between a speaker finishing and the formatted turn
        // arriving - i.e. whenever the user stops recording right after the
        // other person stops talking.
        this.flushPending(source)
        if (this.isActive) {
          this.handleDisconnect(source)
        }
      })

      await state.transcriber.connect()
      state.isConnected = true
      state.reconnectAttempts = 0
      this.broadcastStatus(`${source}-connected`)
      log.info(`[${source.toUpperCase()}] AssemblyAI connected`)
      return { success: true }
    } catch (err) {
      log.error(`[${source.toUpperCase()}] AssemblyAI connect failed:`, err)
      return { success: false }
    }
  }

  /**
   * Give up immediately and hand over to the fallback provider.
   *
   * Separate from handleDisconnect because that path is built around retrying;
   * there is nothing to retry here. Guarded so the mic and system streams -
   * which both receive the same permanent error, milliseconds apart - do not
   * each tear the service down.
   */
  private async abortToFallback(): Promise<void> {
    if (!this.isActive || this.aborting) return
    this.aborting = true
    this.isActive = false
    try {
      await this.stop()
      if (this.onFallback) await this.onFallback()
    } finally {
      this.aborting = false
    }
  }

  /** Set when a retry cannot help, so AudioManager can explain the real cause. */
  getPermanentFailure(): { title: string; body: string } | null {
    return this.permanentFailure
      ? { title: this.permanentFailure.title, body: this.permanentFailure.body }
      : null
  }

  private async handleDisconnect(source: AudioSource): Promise<void> {
    const state = source === 'mic' ? this.micState : this.systemState

    // Guard: both 'error' and 'close' can fire for the same disconnection
    if (state.reconnecting) return
    state.reconnecting = true

    state.isConnected = false
    state.reconnectAttempts++

    if (state.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      log.error(`[${source.toUpperCase()}] Exceeded reconnect attempts, triggering fallback`)
      state.reconnecting = false
      if (this.onFallback) {
        await this.stop()
        await this.onFallback()
      }
      return
    }

    log.info(`[${source.toUpperCase()}] Reconnecting (attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`)
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts - 1), 10000)
    await new Promise(r => setTimeout(r, delay))

    if (!this.isActive) {
      state.reconnecting = false
      return
    }

    const apiKey = getApiKey('assemblyaiApiKey')
    if (!apiKey) {
      log.error('AssemblyAI key disappeared before reconnect - triggering fallback')
      state.reconnecting = false
      if (this.onFallback) {
        await this.stop()
        await this.onFallback()
      }
      return
    }

    const result = await this.startTranscriber(source, apiKey)
    state.reconnecting = false
    if (result.success) {
      log.info(`[${source.toUpperCase()}] Reconnected successfully`)
    }
  }

  /**
   * Emit whatever unformatted turn is still held.
   *
   * resolveTurnAction only flushes a held turn when a LATER turn proves the
   * earlier one is over, which never happens if the stream ends first. Called
   * on close and on stop.
   */
  private flushPending(source: AudioSource): void {
    const state = source === 'mic' ? this.micState : this.systemState
    const texts = flushPendingTurn(state.pendingTurn)
    state.pendingTurn = null
    for (const text of texts) {
      this.handleFinalTranscript(text, source)
    }
  }

  sendAudio(buffer: Buffer | ArrayBuffer, source: AudioSource): void {
    const state = source === 'mic' ? this.micState : this.systemState
    if (!state.transcriber || !state.isConnected) return

    try {
      // assemblyai's StreamingTranscriber.sendAudio is typed as
      // ArrayBufferLike (ArrayBuffer | SharedArrayBuffer). Buffer is a
      // Uint8Array view, not ArrayBufferLike, so hand the SDK a tight
      // ArrayBuffer slice. The .slice(byteOffset, byteOffset+byteLength)
      // avoids sending pooled bytes outside this Buffer's logical view,
      // which can happen with Buffer.allocUnsafe / Buffer.from(arrayBuffer).
      const audio: ArrayBuffer = Buffer.isBuffer(buffer)
        ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
        : buffer
      state.transcriber.sendAudio(audio)
    } catch (err) {
      log.error(`[${source.toUpperCase()}] Send error:`, err)
    }
  }

  async stop(): Promise<void> {
    this.isActive = false
    // Before closing: a held turn is real speech the user said or heard, and
    // stopping is the most likely moment for one to be outstanding.
    this.flushPending('mic')
    this.flushPending('system')
    await Promise.all([
      this.closeTranscriber(this.micState),
      this.closeTranscriber(this.systemState),
    ])
    this.micState.reconnectAttempts = 0
    this.systemState.reconnectAttempts = 0
    log.info('AssemblyAI transcription stopped')
  }

  private async closeTranscriber(state: TranscriberState): Promise<void> {
    if (state.transcriber) {
      try {
        await state.transcriber.close()
      } catch (err) {
        log.error('Close error:', err)
      }
      state.transcriber = null
    }
    state.isConnected = false
    state.currentInterim = ''
    state.pendingTurn = null
  }

  private handleFinalTranscript(text: string, source: AudioSource): void {
    const speaker: 'you' | 'them' = source === 'mic' ? 'you' : 'them'
    const now = Date.now()
    const state = source === 'mic' ? this.micState : this.systemState

    const lastEntry = this.transcriptEntries[this.transcriptEntries.length - 1]
    const shouldMerge = lastEntry
      && lastEntry.speaker === speaker
      && (now - lastEntry.timestamp) < TRANSCRIPT_MERGE_WINDOW_MS

    if (shouldMerge && lastEntry) {
      lastEntry.text = `${lastEntry.text} ${text}`
      lastEntry.timestamp = now
    } else {
      if (this.transcriptEntries.length >= MAX_TRANSCRIPT_ENTRIES) {
        this.transcriptEntries = this.transcriptEntries.slice(-Math.floor(MAX_TRANSCRIPT_ENTRIES * 0.8))
      }
      this.transcriptEntries.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        source,
        text,
        speaker,
        timestamp: now,
        isFinal: true,
      })
    }

    state.currentInterim = ''

    const latestEntry = this.transcriptEntries[this.transcriptEntries.length - 1]
    sessionManager.addTranscriptEntry({
      id: latestEntry.id,
      source: latestEntry.source,
      text: latestEntry.text,
      timestamp: latestEntry.timestamp,
      isFinal: true,
    })

    this.broadcastTranscript({
      entry: latestEntry,
      isFinal: true,
      fullTranscript: this.getFullTranscriptText(),
    })
  }

  private handlePartialTranscript(text: string, source: AudioSource): void {
    const speaker: 'you' | 'them' = source === 'mic' ? 'you' : 'them'
    const state = source === 'mic' ? this.micState : this.systemState
    state.currentInterim = text

    sessionManager.addTranscriptEntry({
      id: `interim-${source}`,
      source,
      text,
      timestamp: Date.now(),
      isFinal: false,
    })

    this.broadcastTranscript({
      entry: {
        id: `interim-${source}`,
        source,
        text,
        speaker,
        timestamp: Date.now(),
        isFinal: false,
      },
      isFinal: false,
      fullTranscript: this.getFullTranscriptText(),
      interims: {
        mic: this.micState.currentInterim,
        system: this.systemState.currentInterim,
      },
    })
  }

  getFullTranscript(): string {
    return this.getFullTranscriptText()
  }

  getFullTranscriptWithInterims(): string {
    let text = this.getFullTranscriptText()
    const displayName = (getSetting('displayName') as string) || 'You'

    if (this.systemState.currentInterim) {
      text += `\nThem (still speaking): ${this.systemState.currentInterim}`
    }
    if (this.micState.currentInterim) {
      text += `\n${displayName} (still speaking): ${this.micState.currentInterim}`
    }

    return text
  }

  getTranscriptEntries(): TranscriptEntry[] {
    return this.transcriptEntries
  }

  getTranscriptBySource(source: 'mic' | 'system' | 'all'): string {
    const displayName = (getSetting('displayName') as string) || 'You'
    const filtered = source === 'all'
      ? this.transcriptEntries
      : this.transcriptEntries.filter(e => e.source === source)
    return filtered
      .map(e => `${e.speaker === 'you' ? displayName : 'Them'}: ${e.text}`)
      .join('\n')
  }

  clearTranscript(): void {
    this.transcriptEntries = []
    this.micState.currentInterim = ''
    this.systemState.currentInterim = ''
  }

  private getFullTranscriptText(): string {
    const displayName = (getSetting('displayName') as string) || 'You'
    return this.transcriptEntries
      .map(e => `${e.speaker === 'you' ? displayName : 'Them'}: ${e.text}`)
      .join('\n')
  }

  private broadcastTranscript(data: {
    entry: TranscriptEntry
    isFinal: boolean
    fullTranscript: string
    interims?: { mic: string; system: string }
  }): void {
    try {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send('transcription:update', data)
      }
    } catch (err) {
      log.error('Broadcast to overlay failed:', err)
    }

    try {
      if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
        this.dashboardWindow.webContents.send('transcription:update', data)
      }
    } catch (err) {
      log.error('Broadcast to dashboard failed:', err)
    }
  }

  private broadcastStatus(status: string): void {
    const payload = { status }
    try {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send('transcription:status', payload)
      }
    } catch { /* ignore */ }
    try {
      if (this.dashboardWindow && !this.dashboardWindow.isDestroyed()) {
        this.dashboardWindow.webContents.send('transcription:status', payload)
      }
    } catch { /* ignore */ }
  }
}
