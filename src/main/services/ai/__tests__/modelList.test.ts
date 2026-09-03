import { describe, it, expect } from 'vitest'
import { normalizeModelId, toRemoteModels } from '../modelList'

describe('normalizeModelId', () => {
  it('strips the models/ prefix Gemini returns', () => {
    // Gemini's compat layer lists "models/gemini-2.5-flash" but its
    // chat-completions endpoint wants the bare name, so passing the id through
    // would build a list where every entry is rejected on use.
    expect(normalizeModelId('models/gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })

  it('leaves a bare id alone', () => {
    expect(normalizeModelId('gpt-5.6-luna')).toBe('gpt-5.6-luna')
  })

  it('preserves other slashed ids, which are legitimate', () => {
    // OpenRouter identifies models as vendor/model. Stripping generally would
    // corrupt these.
    expect(normalizeModelId('anthropic/claude-sonnet-5')).toBe('anthropic/claude-sonnet-5')
  })

  it('strips only one leading segment', () => {
    expect(normalizeModelId('models/models/x')).toBe('models/x')
  })

  it('does not strip a mid-string occurrence', () => {
    expect(normalizeModelId('vendor/models/x')).toBe('vendor/models/x')
  })

  it('trims surrounding whitespace before testing the prefix', () => {
    expect(normalizeModelId('  models/gemini-2.5-pro  ')).toBe('gemini-2.5-pro')
  })

  it('does not treat a bare "models/" as a model', () => {
    expect(normalizeModelId('models/')).toBe('')
  })
})

describe('toRemoteModels', () => {
  it('reads the OpenAI shape', () => {
    expect(
      toRemoteModels([
        { id: 'gpt-5.6-luna', object: 'model', owned_by: 'openai' },
        { id: 'gpt-5.5', object: 'model', owned_by: 'openai' },
      ]),
    ).toEqual([
      { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna' },
      { id: 'gpt-5.5', label: 'gpt-5.5' },
    ])
  })

  it('prefers display_name when the provider supplies one', () => {
    expect(toRemoteModels([{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }])).toEqual([
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    ])
  })

  it('falls back to the id when display_name is blank or not a string', () => {
    expect(
      toRemoteModels([
        { id: 'a', display_name: '   ' },
        { id: 'b', display_name: 42 },
        { id: 'c', display_name: null },
      ]),
    ).toEqual([
      { id: 'a', label: 'a' },
      { id: 'b', label: 'b' },
      { id: 'c', label: 'c' },
    ])
  })

  it('preserves order, because both APIs return newest first', () => {
    const ids = toRemoteModels([{ id: 'z' }, { id: 'a' }, { id: 'm' }]).map((m) => m.id)
    expect(ids).toEqual(['z', 'a', 'm'])
  })

  it('normalises ids, so a Gemini list is usable as-is', () => {
    expect(toRemoteModels([{ id: 'models/gemini-2.5-flash' }])).toEqual([
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    ])
  })

  it('de-duplicates ids that collide after normalisation, keeping the first', () => {
    expect(
      toRemoteModels([
        { id: 'models/gemini-2.5-flash', display_name: 'Prefixed' },
        { id: 'gemini-2.5-flash', display_name: 'Bare' },
      ]),
    ).toEqual([{ id: 'gemini-2.5-flash', label: 'Prefixed' }])
  })

  it('drops entries without a usable string id rather than rendering blanks', () => {
    expect(
      toRemoteModels([
        { id: 'keep' },
        { id: '' },
        { id: '   ' },
        { id: 123 },
        { id: null },
        {},
        null,
        'not-an-object',
      ]),
    ).toEqual([{ id: 'keep', label: 'keep' }])
  })

  it('returns empty for anything that is not an array', () => {
    // A provider returning {error: ...} with a 200 must not throw here.
    expect(toRemoteModels(null)).toEqual([])
    expect(toRemoteModels(undefined)).toEqual([])
    expect(toRemoteModels({ data: [] })).toEqual([])
    expect(toRemoteModels('models')).toEqual([])
  })

  it('does not filter by capability', () => {
    // No field says whether a model can serve a chat completion, and guessing
    // from name substrings would hide working models. The picker filters by
    // text instead.
    const ids = toRemoteModels([
      { id: 'text-embedding-3-large' },
      { id: 'whisper-1' },
      { id: 'gpt-5.6-luna' },
    ]).map((m) => m.id)
    expect(ids).toEqual(['text-embedding-3-large', 'whisper-1', 'gpt-5.6-luna'])
  })
})
