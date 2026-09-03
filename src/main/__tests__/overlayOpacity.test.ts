import { describe, it, expect } from 'vitest'
import {
  clampOverlayOpacity,
  OVERLAY_OPACITY_MIN,
  OVERLAY_OPACITY_MAX,
  OVERLAY_OPACITY_MAX_DARWIN,
} from '../../shared/overlayOpacity'

describe('clampOverlayOpacity', () => {
  it('passes through values inside the range', () => {
    expect(clampOverlayOpacity(0.6, 'win32')).toBe(0.6)
    expect(clampOverlayOpacity(0.35, 'win32')).toBe(0.35)
  })

  it('clamps to the floor rather than letting the overlay vanish', () => {
    // Below the floor the buttons are invisible but still clickable, so the
    // user could not recover without editing config.
    expect(clampOverlayOpacity(0, 'win32')).toBe(OVERLAY_OPACITY_MIN)
    expect(clampOverlayOpacity(-5, 'win32')).toBe(OVERLAY_OPACITY_MIN)
  })

  it('clamps to 1 on Windows and Linux', () => {
    expect(clampOverlayOpacity(2, 'win32')).toBe(OVERLAY_OPACITY_MAX)
    expect(clampOverlayOpacity(1, 'linux')).toBe(OVERLAY_OPACITY_MAX)
  })

  it('never reaches a true 1 on darwin', () => {
    // createOverlayWindow sets 0.99 on macOS on purpose: a sub-1 opacity keeps
    // the window on a compositing path that always-on-top +
    // visible-on-all-workspaces relies on. A slider that could reach 1 would
    // silently undo it.
    expect(clampOverlayOpacity(1, 'darwin')).toBe(OVERLAY_OPACITY_MAX_DARWIN)
    expect(clampOverlayOpacity(5, 'darwin')).toBe(OVERLAY_OPACITY_MAX_DARWIN)
  })

  it('falls back to opaque for unusable values, not transparent', () => {
    // A corrupt or missing stored value must not make the overlay disappear.
    expect(clampOverlayOpacity(undefined, 'win32')).toBe(OVERLAY_OPACITY_MAX)
    expect(clampOverlayOpacity(null, 'win32')).toBe(OVERLAY_OPACITY_MAX)
    expect(clampOverlayOpacity(NaN, 'win32')).toBe(OVERLAY_OPACITY_MAX)
    expect(clampOverlayOpacity('nonsense', 'win32')).toBe(OVERLAY_OPACITY_MAX)
    expect(clampOverlayOpacity({}, 'win32')).toBe(OVERLAY_OPACITY_MAX)
  })

  it('accepts numeric strings, since store values round-trip through JSON', () => {
    expect(clampOverlayOpacity('0.5', 'win32')).toBe(0.5)
  })
})
