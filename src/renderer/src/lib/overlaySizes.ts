/**
 * Overlay size presets (S / M / L / XL).
 *
 * Widths respect OVERLAY_MIN_WIDTH / OVERLAY_MIN_HEIGHT (480 x 210) from
 * src/main/constants.ts - S is the minimum-width case, not something smaller.
 *
 * These are PANEL dimensions, not window bounds. The overlay BrowserWindow is
 * fullscreen and transparent; what the user perceives as "the overlay" is a DOM
 * element inside it, sized by panelWidth/panelHeight and anchored by
 * panelRight/panelBottom. An earlier version of this module handed bounds to
 * window:set-overlay-bounds, which shrank the fullscreen window itself - the
 * window visibly jumped to the preset's corner, and dragging broke afterwards
 * because useOverlayDrag clamps the panel against window.innerWidth/Height,
 * which had just collapsed to the preset size.
 *
 * The active preset is DERIVED from the panel's current size rather than
 * stored. Persisting a chosen preset would drift: the panel is also
 * drag-resizable, so a stored 'L' keeps claiming L after the user has dragged
 * it to something else. Deriving means a custom size honestly matches nothing.
 */

export type OverlaySize = 'S' | 'M' | 'L' | 'XL'

export const OVERLAY_SIZE_ORDER: readonly OverlaySize[] = ['S', 'M', 'L', 'XL']

export interface OverlayDimensions {
  width: number
  height: number
}

export const OVERLAY_SIZES: Record<OverlaySize, OverlayDimensions> = {
  S: { width: 480, height: 260 },
  M: { width: 560, height: 360 },
  L: { width: 680, height: 480 },
  XL: { width: 820, height: 620 },
}

/** Normalise a size name; anything unrecognised becomes 'M'. */
export function resolveOverlaySize(value: unknown): OverlaySize {
  return typeof value === 'string' && (OVERLAY_SIZE_ORDER as readonly string[]).includes(value)
    ? (value as OverlaySize)
    : 'M'
}

/**
 * Which preset, if any, the given panel size corresponds to.
 *
 * Returns null for a custom size so the UI can highlight nothing rather than
 * rounding to the nearest preset and implying the user picked it.
 *
 * `tolerance` absorbs the small differences layout clamping can introduce
 * (a preset wider than the free space gets trimmed by placeOverlayPanel)
 * which would otherwise make a preset the user just clicked fail to match
 * itself.
 */
export function matchOverlaySize(
  size: OverlayDimensions | null | undefined,
  tolerance = 8,
): OverlaySize | null {
  if (!size) return null
  for (const name of OVERLAY_SIZE_ORDER) {
    const preset = OVERLAY_SIZES[name]
    if (
      Math.abs(size.width - preset.width) <= tolerance &&
      Math.abs(size.height - preset.height) <= tolerance
    ) {
      return name
    }
  }
  return null
}
