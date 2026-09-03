import { describe, it, expect } from 'vitest'
import {
  OVERLAY_SIZES,
  OVERLAY_SIZE_ORDER,
  resolveOverlaySize,
  matchOverlaySize,
  type OverlaySize,
} from '../overlaySizes'
import {
  placeOverlayPanel,
  EMPTY_OVERLAY_INSETS,
  OVERLAY_PANEL_MARGIN,
} from '../overlayPanelLayout'

// From src/main/constants.ts. Requesting below these would be silently clamped
// by the window manager, so a preset that matched nothing afterwards.
const OVERLAY_MIN_WIDTH = 480
const OVERLAY_MIN_HEIGHT = 210

describe('overlaySizes', () => {
  it('every preset respects the overlay minimum size', () => {
    for (const name of OVERLAY_SIZE_ORDER) {
      expect(OVERLAY_SIZES[name].width).toBeGreaterThanOrEqual(OVERLAY_MIN_WIDTH)
      expect(OVERLAY_SIZES[name].height).toBeGreaterThanOrEqual(OVERLAY_MIN_HEIGHT)
    }
  })

  it('presets increase monotonically', () => {
    for (let i = 1; i < OVERLAY_SIZE_ORDER.length; i++) {
      const prev = OVERLAY_SIZES[OVERLAY_SIZE_ORDER[i - 1]]
      const next = OVERLAY_SIZES[OVERLAY_SIZE_ORDER[i]]
      expect(next.width).toBeGreaterThan(prev.width)
      expect(next.height).toBeGreaterThan(prev.height)
    }
  })

  describe('resolveOverlaySize', () => {
    it('passes through known names', () => {
      for (const name of OVERLAY_SIZE_ORDER) {
        expect(resolveOverlaySize(name)).toBe(name)
      }
    })

    it('falls back to M for anything unrecognised', () => {
      expect(resolveOverlaySize(undefined)).toBe('M')
      expect(resolveOverlaySize('huge')).toBe('M')
      expect(resolveOverlaySize(3)).toBe('M')
    })
  })

  describe('matchOverlaySize', () => {
    it('matches exact preset bounds', () => {
      for (const name of OVERLAY_SIZE_ORDER) {
        expect(matchOverlaySize(OVERLAY_SIZES[name])).toBe(name)
      }
    })

    it('tolerates small window-manager drift', () => {
      // DPI rounding and shadow insets can shift reported bounds by a few px;
      // without tolerance a preset would fail to match immediately after being
      // applied.
      expect(matchOverlaySize({ width: 562, height: 357 })).toBe('M')
    })

    it('returns null for a custom size rather than rounding to a preset', () => {
      // Highlighting the nearest preset would imply the user chose it.
      expect(matchOverlaySize({ width: 1200, height: 900 })).toBeNull()
      expect(matchOverlaySize({ width: 600, height: 300 })).toBeNull()
    })

    it('returns null for missing bounds', () => {
      expect(matchOverlaySize(null)).toBeNull()
      expect(matchOverlaySize(undefined)).toBeNull()
    })
  })

  describe('applying a preset to the panel', () => {
    // These are PANEL dimensions applied through placeOverlayPanel - the same
    // helper the drag rails use. The regression being guarded is unchanged in
    // spirit from when this module produced window bounds: choosing a bigger
    // size must not slide the card sideways or push it off screen. What changed
    // is that a preset no longer resizes the fullscreen overlay WINDOW, which
    // made it jump to the preset's corner and broke dragging afterwards.
    const VW = 1920
    const VH = 1080

    const apply = (size: OverlaySize, right: number, bottom: number, previousHeight: number) =>
      placeOverlayPanel({
        viewportWidth: VW,
        viewportHeight: VH,
        insets: EMPTY_OVERLAY_INSETS,
        width: OVERLAY_SIZES[size].width,
        height: OVERLAY_SIZES[size].height,
        right,
        bottom,
        previousHeight,
      })

    it('leaves the right offset alone when the preset fits', () => {
      // right is an offset from the viewport's right edge, so an unchanged
      // value IS the "no sideways jump" guarantee.
      expect(apply('XL', 40, 40, OVERLAY_SIZES.M.height).right).toBe(40)
    })

    it('grows downward when there is room below, keeping the top edge put', () => {
      const previousHeight = OVERLAY_SIZES.S.height
      const placed = apply('XL', 40, 400, previousHeight)
      expect(placed.bottom).toBe(400 - (OVERLAY_SIZES.XL.height - previousHeight))
    })

    it('grows upward when the card is parked on the bottom margin', () => {
      const placed = apply('XL', 40, OVERLAY_PANEL_MARGIN, OVERLAY_SIZES.S.height)
      expect(placed.bottom).toBe(OVERLAY_PANEL_MARGIN)
    })

    it('keeps every preset fully on screen from a bottom-right park', () => {
      for (const size of OVERLAY_SIZE_ORDER) {
        const placed = apply(size, OVERLAY_PANEL_MARGIN, OVERLAY_PANEL_MARGIN, OVERLAY_SIZES.S.height)
        expect(placed.right).toBeGreaterThanOrEqual(OVERLAY_PANEL_MARGIN)
        expect(placed.bottom).toBeGreaterThanOrEqual(OVERLAY_PANEL_MARGIN)
        expect(placed.right + placed.width).toBeLessThanOrEqual(VW)
        expect(placed.bottom + placed.height).toBeLessThanOrEqual(VH)
      }
    })

    it('trims a preset too large for the viewport instead of overflowing', () => {
      const placed = placeOverlayPanel({
        viewportWidth: 600,
        viewportHeight: 500,
        insets: EMPTY_OVERLAY_INSETS,
        width: OVERLAY_SIZES.XL.width,
        height: OVERLAY_SIZES.XL.height,
        right: OVERLAY_PANEL_MARGIN,
        bottom: OVERLAY_PANEL_MARGIN,
        previousHeight: OVERLAY_SIZES.S.height,
      })
      expect(placed.width).toBeLessThanOrEqual(600)
      expect(placed.height).toBeLessThanOrEqual(500)
    })

    it('a trimmed preset then matches nothing, so the UI highlights nothing', () => {
      // Honest feedback: if XL had to be shrunk to fit, claiming XL is active
      // would be a lie.
      const placed = placeOverlayPanel({
        viewportWidth: 600,
        viewportHeight: 500,
        insets: EMPTY_OVERLAY_INSETS,
        width: OVERLAY_SIZES.XL.width,
        height: OVERLAY_SIZES.XL.height,
        right: OVERLAY_PANEL_MARGIN,
        bottom: OVERLAY_PANEL_MARGIN,
        previousHeight: OVERLAY_SIZES.S.height,
      })
      expect(matchOverlaySize({ width: placed.width, height: placed.height })).toBeNull()
    })
  })
})
