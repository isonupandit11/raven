/**
 * Map AssemblyAI v3 "Turn" events onto raven's partial/final transcript model.
 *
 * v2 (RealtimeTranscriber) sent discrete PartialTranscript / FinalTranscript
 * messages, so the mapping was a switch on message_type. v3
 * (StreamingTranscriber) sends a single `turn` event repeatedly for the same
 * turn, carrying two independent flags:
 *
 *   end_of_turn        the speaker has stopped
 *   turn_is_formatted  punctuation and casing have been applied
 *
 * With formatTurns enabled a turn typically ends TWICE - once unformatted with
 * end_of_turn=true, then again formatted. Treating both as final is actively
 * corrupting rather than merely noisy: handleFinalTranscript merges consecutive
 * entries from the same speaker inside TRANSCRIPT_MERGE_WINDOW_MS, so the
 * second final is appended to the first and the sentence appears twice in the
 * transcript - which is then what gets fed to the model.
 *
 * So: finalize only the formatted turn, show the unformatted one as an interim,
 * and carry it as `pending` so nothing is lost if the formatted event never
 * arrives. A pending turn is flushed when a LATER turn appears, which is proof
 * the earlier one is over.
 *
 * Pure and synchronous - no timers - so the "formatted event went missing" path
 * is deterministic and unit-testable rather than a race.
 */

export interface TurnLike {
  turn_order: number
  end_of_turn: boolean
  turn_is_formatted: boolean
  transcript: string
}

export interface PendingTurn {
  turnOrder: number
  text: string
}

export interface TurnDecision {
  /** Texts to append to the transcript as final, in order. */
  finalize: string[]
  /** New interim text, or null to leave the current interim untouched. */
  partial: string | null
  /** Unformatted turn to carry forward, or null to clear. */
  pending: PendingTurn | null
}

/**
 * Decide what a turn event means given the turn we may still be holding.
 *
 * Blank transcripts never finalize. AssemblyAI emits end_of_turn on silence, so
 * a turn with no speech in it would otherwise push an empty entry and, worse,
 * reset the merge window that groups a speaker's consecutive sentences.
 */
export function resolveTurnAction(turn: TurnLike, pending: PendingTurn | null): TurnDecision {
  const text = turn.transcript.trim()
  const finalize: string[] = []

  // A later turn is proof the pending one ended without ever being formatted.
  // Flush it first so ordering is preserved.
  let carried = pending
  if (carried && turn.turn_order > carried.turnOrder) {
    if (carried.text) finalize.push(carried.text)
    carried = null
  }

  // Still speaking.
  if (!turn.end_of_turn) {
    return { finalize, partial: text, pending: carried }
  }

  // Ended and formatted: this is the version worth keeping.
  if (turn.turn_is_formatted) {
    if (text) finalize.push(text)
    // Clearing rather than flushing: any same-turn pending IS this text
    // unformatted, and finalizing both is exactly the duplication above.
    return { finalize, partial: '', pending: null }
  }

  // Ended but not yet formatted. Keep it visible as an interim and hold it, so
  // a missing formatted event costs nothing.
  return {
    finalize,
    partial: text,
    pending: text ? { turnOrder: turn.turn_order, text } : carried,
  }
}

/**
 * Flush whatever is still held, for stream close or stop.
 *
 * Without this the last sentence of a session is lost whenever the speaker
 * stops and the connection closes before the formatted turn lands - i.e. every
 * time the user ends a call the moment the other person finishes talking.
 */
export function flushPendingTurn(pending: PendingTurn | null): string[] {
  return pending && pending.text ? [pending.text] : []
}
