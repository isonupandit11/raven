import { describe, it, expect, vi } from 'vitest'
import {
  applyCursorPrivacy,
  CURSOR_PRIVACY_ATTR,
  CURSOR_PRIVACY_VALUE,
} from '../cursorPrivacy'

describe('applyCursorPrivacy', () => {
  it('marks the root so the stylesheet forces a plain arrow', () => {
    const setAttribute = vi.fn()
    applyCursorPrivacy({ setAttribute })
    expect(setAttribute).toHaveBeenCalledWith(CURSOR_PRIVACY_ATTR, CURSOR_PRIVACY_VALUE)
  })

  it('is idempotent, so mounting twice needs no guard', () => {
    const setAttribute = vi.fn()
    applyCursorPrivacy({ setAttribute })
    applyCursorPrivacy({ setAttribute })
    expect(setAttribute).toHaveBeenCalledTimes(2)
    expect(new Set(setAttribute.mock.calls.map((c) => c.join('=')))).toHaveProperty('size', 1)
  })

  it('takes no mode argument, so there is no way to select the leaking behaviour', () => {
    // The old API accepted 'off' | 'neutral' | 'hidden'. 'off' re-enabled the
    // pointer shape changes this exists to suppress, and 'hidden' hid the
    // cursor from the user as well. Neither was a preference worth offering, so
    // the parameter is gone and privacy is unconditional.
    expect(applyCursorPrivacy).toHaveLength(1)
  })

  it('applies the value the stylesheet actually keys on', () => {
    // Guards against the attribute or value drifting away from
    // assets/index.css, which would silently restore normal cursors.
    expect(CURSOR_PRIVACY_ATTR).toBe('data-cursor-privacy')
    expect(CURSOR_PRIVACY_VALUE).toBe('neutral')
  })
})
