import { describe, it, expect } from 'vitest'
import { classifySttFailure } from '../sttFailure'

describe('classifySttFailure', () => {
  it('classifies the exact error that wasted a 50s session', () => {
    // Verbatim from the log: StreamingError: Unauthorized Connection: Insufficient funds
    const f = classifySttFailure(new Error('Unauthorized Connection: Insufficient funds'))
    expect(f.kind).toBe('permanent')
    expect(f.title).toBe('AssemblyAI has no credit')
    expect(f.body).toContain('insufficient funds')
  })

  it('does not blame the API key for a funds problem', () => {
    // The message begins "Unauthorized Connection", so a naive 'unauthorized'
    // check would shadow the funds match and send the user to re-enter a key
    // that is perfectly fine.
    const f = classifySttFailure(new Error('Unauthorized Connection: Insufficient funds'))
    expect(f.body).not.toMatch(/re-enter/i)
    expect(f.title).not.toMatch(/key/i)
  })

  it('still reports a bare unauthorized error as permanent', () => {
    const f = classifySttFailure(new Error('Unauthorized'))
    expect(f.kind).toBe('permanent')
    expect(f.title).toBe('AssemblyAI refused the connection')
  })

  it.each([
    ['invalid API key provided', 'AssemblyAI key rejected'],
    ['Not authorized for this resource', 'AssemblyAI key rejected'],
    ['Forbidden', 'AssemblyAI access denied'],
    ['Monthly quota exceeded', 'AssemblyAI quota reached'],
    ['payment required', 'AssemblyAI billing problem'],
  ])('treats %j as permanent', (message, title) => {
    const f = classifySttFailure(new Error(message))
    expect(f.kind).toBe('permanent')
    expect(f.title).toBe(title)
  })

  it('is case-insensitive', () => {
    expect(classifySttFailure(new Error('INSUFFICIENT FUNDS')).kind).toBe('permanent')
    expect(classifySttFailure(new Error('insufficient funds')).kind).toBe('permanent')
  })

  it.each([
    'socket hang up',
    'ETIMEDOUT',
    'WebSocket closed unexpectedly',
    'getaddrinfo ENOTFOUND streaming.assemblyai.com',
  ])('treats %j as transient so it still reconnects', (message) => {
    const f = classifySttFailure(new Error(message))
    expect(f.kind).toBe('transient')
  })

  it('defaults to transient for anything unrecognised', () => {
    // Failing towards retry is right for the unknown case: a wrongly-permanent
    // classification kills a recoverable session, whereas a wrongly-transient
    // one costs a few reconnect attempts and then falls back anyway.
    expect(classifySttFailure(new Error('something odd happened')).kind).toBe('transient')
  })

  it('handles non-Error values without throwing', () => {
    expect(classifySttFailure('Insufficient funds').kind).toBe('permanent')
    expect(classifySttFailure(null).kind).toBe('transient')
    expect(classifySttFailure(undefined).kind).toBe('transient')
    expect(classifySttFailure({ weird: true }).kind).toBe('transient')
  })

  it('always names an action the user can take', () => {
    for (const message of [
      'Insufficient funds',
      'Unauthorized',
      'Forbidden',
      'quota exceeded',
      'socket hang up',
    ]) {
      const f = classifySttFailure(new Error(message))
      expect(f.body.length).toBeGreaterThan(20)
      expect(f.title).toBeTruthy()
    }
  })
})
