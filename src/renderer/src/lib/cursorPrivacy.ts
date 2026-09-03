/**
 * Cursor privacy for the overlay. Always on, not a setting.
 *
 * setContentProtection() strips the overlay's pixels out of a screen capture,
 * but the mouse cursor is drawn by the capturer, so it stays visible. With the
 * app's default affordances the pointer becomes a hand over every (invisible)
 * button and an I-beam over every (invisible) text field - so an observer sees
 * the cursor glide into blank space and change shape against nothing, which
 * advertises the overlay more loudly than the window would have.
 *
 * This used to be a three-way choice - 'off' (Normal) / 'neutral' / 'hidden' -
 * and both alternatives to 'neutral' were wrong to offer:
 *
 *   - 'off' re-enabled precisely the tell the feature exists to remove. An
 *     option whose only effect is to leak is a footgun, not a preference.
 *   - 'hidden' (cursor: none) hid the pointer from the USER too, so they were
 *     aiming at a panel they could not see the cursor over; and to a viewer a
 *     cursor that vanishes into blank space is more conspicuous than a steady
 *     arrow, not less.
 *
 * That left one sensible value, so it stopped being a setting. Affordances are
 * now carried by pixels instead - the logo and buttons have visible hover
 * states, which are free because the pixels are the part that IS hidden from a
 * capture. The cursor shape is the part that is not, so it stays inert.
 *
 * The CSS lives in assets/index.css, keyed off a data attribute on <html>.
 * Only the overlay renderer applies it; the dashboard keeps normal cursors.
 */

/** The single attribute value the stylesheet responds to. */
export const CURSOR_PRIVACY_ATTR = 'data-cursor-privacy'
export const CURSOR_PRIVACY_VALUE = 'neutral'

/**
 * Force an inert pointer over the overlay.
 *
 * Idempotent, so it is safe to call on every mount without checking whether a
 * previous run already set it.
 */
export function applyCursorPrivacy(
  root: Pick<HTMLElement, 'setAttribute'>,
): void {
  root.setAttribute(CURSOR_PRIVACY_ATTR, CURSOR_PRIVACY_VALUE)
}
