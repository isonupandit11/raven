import { describe, it, expect } from 'vitest'
import {
  resolveDropdownPlacement,
  availableDropdownHeight,
  DROPDOWN_VIEWPORT_MARGIN,
} from '../dropdownPlacement'

describe('resolveDropdownPlacement', () => {
  it('opens below when there is room', () => {
    expect(resolveDropdownPlacement({ top: 100, bottom: 120 }, 200, 1080)).toBe('below')
  })

  it('flips above when below cannot fit and above can', () => {
    // Trigger near the bottom of the screen - the overlay panel's default
    // bottom-anchored position, which is what made this necessary.
    expect(resolveDropdownPlacement({ top: 900, bottom: 920 }, 256, 1000)).toBe('above')
  })

  it('stays below when neither side fits but below has more room', () => {
    expect(resolveDropdownPlacement({ top: 40, bottom: 60 }, 900, 500)).toBe('below')
  })

  it('does not flip on a marginal difference once below already fits', () => {
    // spaceBelow is exactly the desired height: fits, so no flip even though
    // above is roomier.
    const placement = resolveDropdownPlacement(
      { top: 700, bottom: 720 },
      1000 - 720 - DROPDOWN_VIEWPORT_MARGIN,
      1000,
    )
    expect(placement).toBe('below')
  })

  it('treats an exactly-equal split as below, keeping the familiar direction', () => {
    // spaceAbove === spaceBelow -> the > comparison must not flip.
    expect(resolveDropdownPlacement({ top: 508, bottom: 508 }, 999, 1016)).toBe('below')
  })

  it('honours a custom margin', () => {
    // 200px below the trigger; a 150px margin leaves 50, so a 100px dropdown
    // no longer fits and above (400px) wins.
    expect(resolveDropdownPlacement({ top: 400, bottom: 800 }, 100, 1000, 150)).toBe('above')
  })
})

describe('availableDropdownHeight', () => {
  it('measures downward space', () => {
    expect(availableDropdownHeight({ top: 100, bottom: 200 }, 'below', 1000)).toBe(
      1000 - 200 - DROPDOWN_VIEWPORT_MARGIN,
    )
  })

  it('measures upward space', () => {
    expect(availableDropdownHeight({ top: 300, bottom: 400 }, 'above', 1000)).toBe(
      300 - DROPDOWN_VIEWPORT_MARGIN,
    )
  })

  it('floors at a usable strip rather than returning zero or negative', () => {
    // Trigger flush against the top edge: upward space is negative.
    expect(availableDropdownHeight({ top: 0, bottom: 20 }, 'above', 1000)).toBe(96)
  })

  it('never returns a negative height for a trigger past the bottom edge', () => {
    expect(availableDropdownHeight({ top: 1200, bottom: 1300 }, 'below', 1000)).toBe(96)
  })

  it('rounds to whole pixels so the style value is clean', () => {
    expect(availableDropdownHeight({ top: 100, bottom: 200.4 }, 'below', 1000)).toBe(
      Math.round(1000 - 200.4 - DROPDOWN_VIEWPORT_MARGIN),
    )
  })
})
