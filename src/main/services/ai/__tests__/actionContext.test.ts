import { describe, it, expect } from 'vitest'
import { blockedActionReason } from '../actionContext'

describe('blockedActionReason', () => {
  describe('transcript-only actions', () => {
    const actions = ['what-should-i-say', 'follow-up', 'recap', 'tell-me-more']

    it.each(actions)('blocks %s when the transcript is empty', (action) => {
      // The regression: this combination produced a fully-formed answer to a
      // question nobody asked, because the prompt referred to a <transcript>
      // section that was never sent, so the model supplied one.
      expect(blockedActionReason({ action, transcript: '' })).toContain(
        'Nothing has been transcribed yet',
      )
    })

    it.each(actions)('blocks %s when the transcript is only whitespace', (action) => {
      expect(blockedActionReason({ action, transcript: '   \n\t  ' })).not.toBeNull()
    })

    it.each(actions)('allows %s once there is a transcript', (action) => {
      expect(blockedActionReason({ action, transcript: 'Them: hello' })).toBeNull()
    })

    it('is not rescued by a screenshot, because the prompt is about the conversation', () => {
      // A screen grab cannot tell you what the other party just said, so
      // "what should I say" still has nothing to ground it.
      expect(
        blockedActionReason({ action: 'what-should-i-say', transcript: '', hasScreenshot: true }),
      ).not.toBeNull()
    })

    it('is not rescued by a customPrompt, which these actions ignore', () => {
      expect(
        blockedActionReason({ action: 'recap', transcript: '', customPrompt: 'recap it' }),
      ).not.toBeNull()
    })
  })

  describe('assist', () => {
    it('blocks when there is neither transcript nor screenshot', () => {
      expect(blockedActionReason({ action: 'assist', transcript: '' })).toContain(
        'No transcript and no screenshot',
      )
    })

    it('allows with a transcript alone', () => {
      expect(blockedActionReason({ action: 'assist', transcript: 'Them: hi' })).toBeNull()
    })

    it('allows with a screenshot alone', () => {
      // ACTION_PROMPTS.assist explicitly handles "if <screen> shows a solvable
      // problem", so a screen is real context for this action specifically.
      expect(
        blockedActionReason({ action: 'assist', transcript: '', hasScreenshot: true }),
      ).toBeNull()
    })

    it('treats a whitespace transcript as absent', () => {
      expect(blockedActionReason({ action: 'assist', transcript: '\n \n' })).not.toBeNull()
    })
  })

  describe('custom', () => {
    it('is never blocked, because the user supplied the content', () => {
      expect(
        blockedActionReason({ action: 'custom', transcript: '', customPrompt: 'what is a monad' }),
      ).toBeNull()
    })

    it('is not blocked even with no customPrompt recorded', () => {
      // The caller validates its own prompt; this guard is only about
      // fabricating context the user never provided.
      expect(blockedActionReason({ action: 'custom', transcript: '' })).toBeNull()
    })
  })

  it('does not block an unknown action, so a new one is not silently disabled', () => {
    // Failing open here is deliberate: a future action added without touching
    // this file should keep working, and a wrongly-blocked action is a visible
    // dead button, whereas an unguarded one is only a risk if it is
    // transcript-shaped - at which point it belongs in the set above.
    expect(blockedActionReason({ action: 'brand-new-thing', transcript: '' })).toBeNull()
  })
})
