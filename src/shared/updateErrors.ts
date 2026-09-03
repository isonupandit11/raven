/**
 * Distinguish "this build has no update channel" from "updating failed".
 *
 * A locally-built installer carries no app-update.yml, because that file is
 * emitted from electron-builder's `publish` config. electron-updater then
 * throws ENOENT the first time it checks, the error event fires, and Settings
 * shows:
 *
 *   Update failed
 *   ENOENT: no such file or directory, open
 *   'C:\Users\...\Programs\Raven\resources\app-update.yml'
 *
 * That is not a failure the user can do anything about, and it is guaranteed in
 * every build made without a publish target - so presenting it as a red error
 * trains the user to ignore the one place a real update problem would appear.
 *
 * Deliberately a string match. electron-updater wraps the underlying fs error
 * without a stable code or class to test, so the message is the only signal
 * available; the alternative is treating every update error as benign, which
 * would hide the ones that matter.
 */

export type UpdateErrorKind = 'not-configured' | 'error'

/**
 * True when the message means "no update channel in this build".
 *
 * Matches on the config FILE plus a not-found signal, not on ENOENT alone: an
 * ENOENT for anything else - a missing downloaded installer, say - is a real
 * failure and must keep surfacing.
 */
export function isUpdateNotConfigured(message: string): boolean {
  const m = (message || '').toLowerCase()
  const namesUpdateConfig = m.includes('app-update.yml') || m.includes('dev-app-update.yml')
  if (!namesUpdateConfig) return false
  return (
    m.includes('enoent')
    || m.includes('no such file')
    || m.includes('cannot find')
    || m.includes('not found')
  )
}

export function classifyUpdateError(message: string): UpdateErrorKind {
  return isUpdateNotConfigured(message) ? 'not-configured' : 'error'
}
