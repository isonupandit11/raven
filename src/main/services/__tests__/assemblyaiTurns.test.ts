import { describe, it, expect } from 'vitest'
import {
  resolveTurnAction,
  flushPendingTurn,
  type TurnLike,
  type PendingTurn,
} from '../assemblyaiTurns'

const turn = (over: Partial<TurnLike> = {}): TurnLike => ({
  turn_order: 1,
  end_of_turn: false,
  turn_is_formatted: false,
  transcript: '',
  ...over,
})

describe('resolveTurnAction', () => {
  it('treats a mid-turn event as an interim', () => {
    const d = resolveTurnAction(turn({ transcript: 'hello wor' }), null)
    expect(d).toEqual({ finalize: [], partial: 'hello wor', pending: null })
  })

  it('finalizes the formatted turn', () => {
    const d = resolveTurnAction(
      turn({ end_of_turn: true, turn_is_formatted: true, transcript: 'Hello, world.' }),
      null,
    )
    expect(d).toEqual({ finalize: ['Hello, world.'], partial: '', pending: null })
  })

  it('does NOT finalize the unformatted end of a turn', () => {
    // The whole point: finalizing here and again on the formatted event would
    // duplicate the sentence, because handleFinalTranscript merges consecutive
    // same-speaker entries inside the merge window.
    const d = resolveTurnAction(
      turn({ end_of_turn: true, transcript: 'hello world' }),
      null,
    )
    expect(d.finalize).toEqual([])
    expect(d.partial).toBe('hello world')
    expect(d.pending).toEqual({ turnOrder: 1, text: 'hello world' })
  })

  it('emits exactly one final across the unformatted-then-formatted pair', () => {
    const a = resolveTurnAction(turn({ end_of_turn: true, transcript: 'hello world' }), null)
    const b = resolveTurnAction(
      turn({ end_of_turn: true, turn_is_formatted: true, transcript: 'Hello, world.' }),
      a.pending,
    )
    expect([...a.finalize, ...b.finalize]).toEqual(['Hello, world.'])
    expect(b.pending).toBeNull()
  })

  it('flushes a pending turn when a later turn appears, preserving order', () => {
    // Proof the earlier turn ended without ever being formatted.
    const pending: PendingTurn = { turnOrder: 1, text: 'first sentence' }
    const d = resolveTurnAction(turn({ turn_order: 2, transcript: 'sec' }), pending)
    expect(d.finalize).toEqual(['first sentence'])
    expect(d.partial).toBe('sec')
    expect(d.pending).toBeNull()
  })

  it('flushes the pending turn before finalizing a later formatted turn', () => {
    const pending: PendingTurn = { turnOrder: 1, text: 'first' }
    const d = resolveTurnAction(
      turn({ turn_order: 2, end_of_turn: true, turn_is_formatted: true, transcript: 'Second.' }),
      pending,
    )
    expect(d.finalize).toEqual(['first', 'Second.'])
    expect(d.pending).toBeNull()
  })

  it('never finalizes the same turn twice via the pending path', () => {
    const pending: PendingTurn = { turnOrder: 3, text: 'same turn' }
    const d = resolveTurnAction(
      turn({ turn_order: 3, end_of_turn: true, turn_is_formatted: true, transcript: 'Same turn.' }),
      pending,
    )
    expect(d.finalize).toEqual(['Same turn.'])
  })

  it('ignores a blank formatted turn', () => {
    // AssemblyAI ends turns on silence, so an empty turn would push an empty
    // entry and reset the merge window that groups a speaker's sentences.
    const d = resolveTurnAction(
      turn({ end_of_turn: true, turn_is_formatted: true, transcript: '   ' }),
      null,
    )
    expect(d.finalize).toEqual([])
    expect(d.partial).toBe('')
  })

  it('does not hold a blank unformatted turn as pending', () => {
    const d = resolveTurnAction(turn({ end_of_turn: true, transcript: '  ' }), null)
    expect(d.pending).toBeNull()
  })

  it('keeps an existing pending turn when a blank unformatted turn arrives for it', () => {
    const pending: PendingTurn = { turnOrder: 1, text: 'real text' }
    const d = resolveTurnAction(turn({ turn_order: 1, end_of_turn: true, transcript: '' }), pending)
    expect(d.pending).toEqual(pending)
    expect(d.finalize).toEqual([])
  })

  it('trims whitespace off transcripts', () => {
    const d = resolveTurnAction(
      turn({ end_of_turn: true, turn_is_formatted: true, transcript: '  Hi there.  ' }),
      null,
    )
    expect(d.finalize).toEqual(['Hi there.'])
  })

  it('does not flush a pending turn on an earlier or equal turn_order', () => {
    const pending: PendingTurn = { turnOrder: 5, text: 'held' }
    expect(resolveTurnAction(turn({ turn_order: 5, transcript: 'x' }), pending).finalize).toEqual([])
    expect(resolveTurnAction(turn({ turn_order: 4, transcript: 'x' }), pending).finalize).toEqual([])
  })

  it('handles a full two-turn conversation without loss or duplication', () => {
    const events: TurnLike[] = [
      turn({ turn_order: 1, transcript: 'can you' }),
      turn({ turn_order: 1, transcript: 'can you tell me' }),
      turn({ turn_order: 1, end_of_turn: true, transcript: 'can you tell me more' }),
      turn({ turn_order: 1, end_of_turn: true, turn_is_formatted: true, transcript: 'Can you tell me more?' }),
      turn({ turn_order: 2, transcript: 'sure' }),
      turn({ turn_order: 2, end_of_turn: true, transcript: 'sure absolutely' }),
      turn({ turn_order: 2, end_of_turn: true, turn_is_formatted: true, transcript: 'Sure, absolutely.' }),
    ]
    let pending: PendingTurn | null = null
    const finals: string[] = []
    for (const e of events) {
      const d = resolveTurnAction(e, pending)
      finals.push(...d.finalize)
      pending = d.pending
    }
    expect(finals).toEqual(['Can you tell me more?', 'Sure, absolutely.'])
    expect(pending).toBeNull()
  })

  it('loses nothing when the formatted event never arrives for either turn', () => {
    const events: TurnLike[] = [
      turn({ turn_order: 1, end_of_turn: true, transcript: 'first thing' }),
      turn({ turn_order: 2, end_of_turn: true, transcript: 'second thing' }),
    ]
    let pending: PendingTurn | null = null
    const finals: string[] = []
    for (const e of events) {
      const d = resolveTurnAction(e, pending)
      finals.push(...d.finalize)
      pending = d.pending
    }
    // The last one is still held; the close path flushes it.
    expect(finals).toEqual(['first thing'])
    expect(flushPendingTurn(pending)).toEqual(['second thing'])
  })
})

describe('flushPendingTurn', () => {
  it('returns the held text', () => {
    expect(flushPendingTurn({ turnOrder: 1, text: 'tail end' })).toEqual(['tail end'])
  })

  it('returns nothing when there is nothing held', () => {
    expect(flushPendingTurn(null)).toEqual([])
  })

  it('returns nothing for a blank held text', () => {
    expect(flushPendingTurn({ turnOrder: 1, text: '' })).toEqual([])
  })
})
