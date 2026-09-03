import { describe, it, expect } from 'vitest'
import { stripPromptScaffolding } from '../../shared/promptScaffolding'

describe('stripPromptScaffolding', () => {
  it('removes the exact leak that was reported', () => {
    const input = '<transcript> </transcript>\nNot sure what you need help with right now.'
    expect(stripPromptScaffolding(input)).toBe('Not sure what you need help with right now.')
  })

  it('removes an empty pair with no inner whitespace', () => {
    expect(stripPromptScaffolding('<transcript></transcript>\nHello')).toBe('Hello')
  })

  it('removes an empty pair with attributes on the opening tag', () => {
    // buildTranscriptBlock emits <transcript note="unchanged_since_last">.
    expect(
      stripPromptScaffolding('<transcript note="unchanged_since_last"></transcript>\nHi'),
    ).toBe('Hi')
  })

  it('removes an empty pair spanning newlines', () => {
    expect(stripPromptScaffolding('<screen>\n\n</screen>\nAnswer')).toBe('Answer')
  })

  it('removes a lone tag on its own line', () => {
    expect(stripPromptScaffolding('<user_input>\nThe answer is 4.')).toBe('The answer is 4.')
    expect(stripPromptScaffolding('The answer is 4.\n</user_input>')).toBe('The answer is 4.')
  })

  it('handles every scaffold section name', () => {
    for (const tag of [
      'transcript',
      'screen',
      'user_input',
      'reference_documents',
      'priority_system',
      'mode_personality',
      'mode_authority',
      'content_formats',
    ]) {
      expect(stripPromptScaffolding(`<${tag}> </${tag}>\nkept`)).toBe('kept')
    }
  })

  it('is case-insensitive', () => {
    expect(stripPromptScaffolding('<TRANSCRIPT></TRANSCRIPT>\nkept')).toBe('kept')
  })

  it('leaves a pair with real content alone', () => {
    // At that point the inner text is what the user wants to read; guessing at
    // its boundaries risks deleting the answer.
    const input = '<transcript>Them: hello there</transcript>'
    expect(stripPromptScaffolding(input)).toBe(input)
  })

  it('does not touch unrelated markup', () => {
    const input = 'Use `<div>` for layout and <b>bold</b> for emphasis.'
    expect(stripPromptScaffolding(input)).toBe(input)
  })

  it('does not touch a scaffold-named tag that is inline in a sentence', () => {
    // Only whole-line or empty-pair occurrences are scaffolding echo. An answer
    // that mentions the tag in prose is discussing it, not leaking it.
    const input = 'The prompt puts speech inside <transcript> before sending.'
    expect(stripPromptScaffolding(input)).toBe(input)
  })

  it('preserves a code fence that happens to contain a matching line', () => {
    // A model writing about HTML could produce <screen> alone on a line inside
    // a fence. This is the known, accepted cost of the standalone-line rule -
    // asserted so the trade-off is visible if it ever needs revisiting.
    const input = '```html\n<screen>\n```'
    expect(stripPromptScaffolding(input)).toBe('```html\n```')
  })

  it('drops a truncated tag at the end while streaming', () => {
    expect(stripPromptScaffolding('Answer so far <transcr', { streaming: true })).toBe(
      'Answer so far ',
    )
  })

  it('keeps a truncated fragment when not streaming, since it is final text', () => {
    expect(stripPromptScaffolding('Answer so far <transcr')).toBe('Answer so far <transcr')
  })

  it('does not eat a trailing less-than that is part of the answer', () => {
    // "x <" is a comparison the model was mid-sentence on; the partial-tag rule
    // only removes it while streaming, when it is genuinely ambiguous.
    expect(stripPromptScaffolding('if x < y then')).toBe('if x < y then')
  })

  it('collapses the blank run left behind by a removed section', () => {
    expect(stripPromptScaffolding('<transcript> </transcript>\n\n\n\nAnswer')).toBe('Answer')
  })

  it('trims leading whitespace so the answer starts at the top', () => {
    expect(stripPromptScaffolding('\n\n   Answer')).toBe('Answer')
  })

  it('returns empty and falsy input unchanged', () => {
    expect(stripPromptScaffolding('')).toBe('')
  })

  it('leaves a normal answer byte-identical', () => {
    const input = 'Say: "I led the migration and cut deploy time by 40%."'
    expect(stripPromptScaffolding(input)).toBe(input)
  })
})
