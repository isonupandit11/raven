/**
 * Which side of its trigger a dropdown should open on.
 *
 * The overlay panel is bottom-anchored by default, so its control bar can sit
 * only a couple of hundred pixels from the bottom of the screen. A dropdown
 * that always opened downwards ran off the display there - and because the
 * overlay is a fullscreen transparent window, nothing scrolls it back into
 * view: the part past the screen edge is simply gone.
 *
 * Pure function of geometry so the decision is unit-testable without a DOM.
 */
export type DropdownPlacement = 'below' | 'above'

export const DROPDOWN_VIEWPORT_MARGIN = 8

/**
 * Prefer 'below' - it matches the caret and is what a reader expects. Flip to
 * 'above' only when below genuinely cannot fit AND above has more room, so a
 * cramped-both-ways case still opens in the familiar direction rather than
 * flipping on a one-pixel difference.
 */
export function resolveDropdownPlacement(
  trigger: { top: number; bottom: number },
  desiredHeight: number,
  viewportHeight: number,
  margin: number = DROPDOWN_VIEWPORT_MARGIN,
): DropdownPlacement {
  const spaceBelow = viewportHeight - trigger.bottom - margin
  const spaceAbove = trigger.top - margin

  if (spaceBelow >= desiredHeight) return 'below'
  return spaceAbove > spaceBelow ? 'above' : 'below'
}

/**
 * How tall the dropdown may actually be once placed. Callers cap their own
 * max-height with this so a dropdown that does not fit becomes scrollable
 * instead of overflowing the screen.
 */
export function availableDropdownHeight(
  trigger: { top: number; bottom: number },
  placement: DropdownPlacement,
  viewportHeight: number,
  margin: number = DROPDOWN_VIEWPORT_MARGIN,
): number {
  const space =
    placement === 'below' ? viewportHeight - trigger.bottom - margin : trigger.top - margin
  // Never return a negative or uselessly small value; a trigger flush against
  // an edge should still yield a usable strip rather than a 0px element the
  // user cannot see or scroll.
  return Math.max(96, Math.round(space))
}
