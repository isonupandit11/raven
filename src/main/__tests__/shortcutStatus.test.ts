import { describe, it, expect } from 'vitest'
import {
  collectUnavailable,
  setUnavailableShortcuts,
  getUnavailableShortcuts,
} from '../shortcutStatus'

describe('shortcutStatus', () => {
  describe('collectUnavailable', () => {
    it('returns only the accelerators that failed', () => {
      expect(
        collectUnavailable([
          ['Ctrl+\\', false],
          ['Ctrl+Return', true],
          ['Ctrl+Shift+Space', true],
          ['Ctrl+Shift+Up', false],
        ]),
      ).toEqual(['Ctrl+\\', 'Ctrl+Shift+Up'])
    })

    it('returns empty when everything registered', () => {
      expect(collectUnavailable([['Ctrl+\\', true], ['Ctrl+Return', true]])).toEqual([])
    })

    it('preserves order so the message lists them predictably', () => {
      expect(
        collectUnavailable([
          ['B', false],
          ['A', false],
        ]),
      ).toEqual(['B', 'A'])
    })
  })

  describe('set/get', () => {
    it('round-trips', () => {
      setUnavailableShortcuts(['Ctrl+\\'])
      expect(getUnavailableShortcuts()).toEqual(['Ctrl+\\'])
    })

    it('replaces rather than appends, so a later re-register clears stale entries', () => {
      setUnavailableShortcuts(['Ctrl+\\', 'Ctrl+Return'])
      setUnavailableShortcuts(['Ctrl+Return'])
      expect(getUnavailableShortcuts()).toEqual(['Ctrl+Return'])
    })

    it('returns a copy, so a caller cannot mutate the recorded state', () => {
      setUnavailableShortcuts(['Ctrl+\\'])
      const first = getUnavailableShortcuts()
      first.push('injected')
      expect(getUnavailableShortcuts()).toEqual(['Ctrl+\\'])
    })

    it('does not alias the array it was given', () => {
      const source = ['Ctrl+\\']
      setUnavailableShortcuts(source)
      source.push('added-later')
      expect(getUnavailableShortcuts()).toEqual(['Ctrl+\\'])
    })
  })
})
