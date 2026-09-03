import { describe, it, expect } from 'vitest'
import { isUpdateNotConfigured, classifyUpdateError } from '../../shared/updateErrors'

describe('isUpdateNotConfigured', () => {
  it('recognises the exact error the installed build showed', () => {
    // Verbatim from the report: Settings displayed this under "Update failed".
    expect(
      isUpdateNotConfigured(
        "ENOENT: no such file or directory, open 'C:\\Users\\Sonu\\AppData\\Local\\Programs\\Raven\\resources\\app-update.yml'",
      ),
    ).toBe(true)
  })

  it('recognises the dev variant', () => {
    expect(isUpdateNotConfigured('ENOENT: no such file or directory, open dev-app-update.yml')).toBe(
      true,
    )
  })

  it('is case-insensitive', () => {
    expect(isUpdateNotConfigured('enoent ... APP-UPDATE.YML')).toBe(true)
  })

  it('accepts other not-found phrasings for the same file', () => {
    expect(isUpdateNotConfigured('Cannot find app-update.yml')).toBe(true)
    expect(isUpdateNotConfigured('app-update.yml not found')).toBe(true)
  })

  it('does NOT swallow an ENOENT for something else', () => {
    // A missing downloaded installer is a real failure and must keep
    // surfacing. Matching on ENOENT alone would have hidden it.
    expect(
      isUpdateNotConfigured("ENOENT: no such file or directory, open 'Raven-Setup-2.4.4.exe'"),
    ).toBe(false)
  })

  it('does NOT swallow real update failures', () => {
    for (const msg of [
      'net::ERR_INTERNET_DISCONNECTED',
      'HttpError: 404 Not Found (latest.yml)',
      'Error: sha512 checksum mismatch',
      'ENOSPC: no space left on device',
      'Cannot find channel "latest"',
    ]) {
      expect(isUpdateNotConfigured(msg)).toBe(false)
    }
  })

  it('handles empty and missing input', () => {
    expect(isUpdateNotConfigured('')).toBe(false)
    expect(isUpdateNotConfigured(undefined as unknown as string)).toBe(false)
  })
})

describe('classifyUpdateError', () => {
  it('classifies the missing config as not-configured', () => {
    expect(classifyUpdateError('ENOENT ... app-update.yml')).toBe('not-configured')
  })

  it('classifies anything else as a real error', () => {
    expect(classifyUpdateError('sha512 mismatch')).toBe('error')
  })
})
