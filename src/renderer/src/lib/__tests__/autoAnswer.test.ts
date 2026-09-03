import { describe, it, expect } from 'vitest'
import {
  shouldAutoAnswer,
  looksLikeQuestion,
  AUTO_ANSWER_COOLDOWN_MS,
  type AutoAnswerInput,
} from '../autoAnswer'

const base = (over: Partial<AutoAnswerInput> = {}): AutoAnswerInput => ({
  speaker: 'them',
  text: 'Can you tell me about a time you managed a project?',
  isFinal: true,
  enabled: true,
  busy: false,
  now: 100_000,
  lastFiredAt: null,
  ...over,
})

describe('looksLikeQuestion', () => {
  it('accepts anything ending in a question mark', () => {
    expect(looksLikeQuestion('So what happened next?')).toBe(true)
  })

  it('accepts the real transcript that prompted this feature', () => {
    // Verbatim from the log. A start-anchored match would have missed it,
    // because real speech does not put the interrogative first.
    expect(looksLikeQuestion('I so tell me what is dependency injection is')).toBe(true)
  })

  it('accepts a mid-sentence cue', () => {
    expect(looksLikeQuestion('Right, so describe your approach to testing')).toBe(true)
    expect(looksLikeQuestion('And how does dependency injection help there')).toBe(true)
  })

  it('accepts a leading interrogative with no question mark', () => {
    expect(looksLikeQuestion('what would you do differently')).toBe(true)
    expect(looksLikeQuestion('Do you have experience with Kubernetes')).toBe(true)
  })

  it('rejects a statement', () => {
    expect(looksLikeQuestion('We shipped the migration last quarter.')).toBe(false)
    expect(looksLikeQuestion('That sounds reasonable to me.')).toBe(false)
  })

  it('does not treat a mid-sentence "can" or "do" as a question', () => {
    // Anchoring these matters: unanchored, they would match ordinary speech.
    expect(looksLikeQuestion('I can do that by Friday.')).toBe(false)
    expect(looksLikeQuestion('We do have a staging environment.')).toBe(false)
  })

  it('rejects empty and whitespace', () => {
    expect(looksLikeQuestion('')).toBe(false)
    expect(looksLikeQuestion('   ')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(looksLikeQuestion('TELL ME ABOUT YOUR BACKGROUND')).toBe(true)
  })
})

describe('shouldAutoAnswer', () => {
  it('fires on a question from the other party', () => {
    const d = shouldAutoAnswer(base())
    expect(d.fire).toBe(true)
    expect(d.reason).toBe('question from them')
  })

  it('never fires on the user\'s own speech', () => {
    // The most important guard. The mic stream is the user; firing on it would
    // answer continuously while they talk, and answer their own words back.
    expect(shouldAutoAnswer(base({ speaker: 'you' }))).toEqual({
      fire: false,
      reason: 'own speech',
    })
  })

  it('never fires on an interim', () => {
    // Interims change as speech arrives, so this would answer half a question
    // and then trigger again on the rest.
    expect(shouldAutoAnswer(base({ isFinal: false })).fire).toBe(false)
  })

  it('does not fire when disabled', () => {
    expect(shouldAutoAnswer(base({ enabled: false })).reason).toBe('disabled')
  })

  it('does not fire while a request is in flight', () => {
    // The main-process guard would drop it silently, and the cooldown would then
    // be armed for an answer that never happened.
    expect(shouldAutoAnswer(base({ busy: true })).reason).toBe('busy')
  })

  it('ignores short acknowledgements', () => {
    // Straight from the transcript: "Okay. Tell me." ends a turn but is not a
    // question worth a request.
    expect(shouldAutoAnswer(base({ text: 'Okay.' })).reason).toBe('too short')
    expect(shouldAutoAnswer(base({ text: 'Yeah sure' })).reason).toBe('too short')
  })

  it('respects the cooldown', () => {
    const d = shouldAutoAnswer(base({ lastFiredAt: 100_000 - (AUTO_ANSWER_COOLDOWN_MS - 1) }))
    expect(d.reason).toBe('cooldown')
  })

  it('fires again once the cooldown has elapsed', () => {
    const d = shouldAutoAnswer(base({ lastFiredAt: 100_000 - AUTO_ANSWER_COOLDOWN_MS }))
    expect(d.fire).toBe(true)
  })

  it('does not fire on a long statement from the other party', () => {
    expect(
      shouldAutoAnswer(
        base({ text: 'We rewrote the billing service in Go last year and it went fine.' }),
      ).reason,
    ).toBe('not a question')
  })

  it('checks cheap guards before the question heuristic', () => {
    // Ordering matters for the reason string, which is what gets logged: an
    // interim from the user should not be reported as "not a question".
    expect(shouldAutoAnswer(base({ speaker: 'you', text: 'ok' })).reason).toBe('own speech')
    expect(shouldAutoAnswer(base({ isFinal: false, text: 'ok' })).reason).toBe('not final')
  })

  it('handles a burst of turns as one answer', () => {
    // A speaker ends several turns in a row; without the cooldown a single
    // question costs three requests whose answers race into the panel.
    let lastFiredAt: number | null = null
    const fired: string[] = []
    const turns = [
      { at: 0, text: 'So tell me about your background' },
      { at: 1_500, text: 'Take your time with it' },
      { at: 3_000, text: 'What would you highlight' },
      { at: 20_000, text: 'And how did you test that' },
    ]
    for (const turn of turns) {
      const d = shouldAutoAnswer(base({ text: turn.text, now: turn.at, lastFiredAt }))
      if (d.fire) {
        fired.push(turn.text)
        lastFiredAt = turn.at
      }
    }
    expect(fired).toEqual(['So tell me about your background', 'And how did you test that'])
  })
})
