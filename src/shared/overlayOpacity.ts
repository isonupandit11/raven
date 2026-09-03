/**
 * Overlay opacity, shared by the main process (which applies it) and the
 * renderer (which draws the slider) so both agree on the legal range.
 */

/**
 * Below this the overlay is effectively unreadable and, worse, its buttons
 * become invisible while still accepting clicks - so the user cannot recover
 * without editing config. The floor keeps it always dismissable.
 */
export const OVERLAY_OPACITY_MIN = 0.3
export const OVERLAY_OPACITY_MAX = 1

/**
 * macOS ceiling. createOverlayWindow sets 0.99 there deliberately: a value
 * below 1 keeps the window on a compositing path that the always-on-top +
 * visible-on-all-workspaces combination depends on. Allowing a true 1 on
 * darwin would undo that, so the ceiling stays just under.
 */
export const OVERLAY_OPACITY_MAX_DARWIN = 0.99

export function clampOverlayOpacity(value: unknown, platform: string = process.platform): number {
  const max = platform === 'darwin' ? OVERLAY_OPACITY_MAX_DARWIN : OVERLAY_OPACITY_MAX

  // Deliberately NOT `Number(value)` on anything: Number(null), Number('') and
  // Number([]) are all 0, which would clamp to the FLOOR and leave the overlay
  // nearly transparent whenever the setting was missing or corrupt - the exact
  // failure this guard exists to prevent. Only real numbers and non-blank
  // numeric strings are accepted; everything else falls back to opaque.
  let n: number
  if (typeof value === 'number') {
    n = value
  } else if (typeof value === 'string' && value.trim() !== '') {
    n = Number(value)
  } else {
    return max
  }

  if (!Number.isFinite(n)) return max
  return Math.min(Math.max(n, OVERLAY_OPACITY_MIN), max)
}
