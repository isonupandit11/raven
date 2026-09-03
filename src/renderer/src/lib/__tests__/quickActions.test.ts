import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Contract test between the overlay's quick-action buttons and the main
 * process's ACTION_PROMPTS map.
 *
 * claudeService resolves an action with:
 *   ACTION_PROMPTS[params.action] || ACTION_PROMPTS.assist
 *
 * So a mistyped or renamed action id does NOT throw - it silently produces an
 * Assist answer under a different button label. Nothing in the UI reveals it,
 * and it would pass review. Rather than duplicating the id list (which could
 * itself drift), this reads both real files and cross-checks them.
 *
 * Mirrors readmeAccuracy.test.ts, which asserts against source rather than a
 * copy for the same reason.
 */

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), 'utf-8')

const overlaySource = read('src', 'renderer', 'src', 'components', 'overlay', 'OverlayWindow.tsx')
const claudeServiceSource = read('src', 'main', 'claudeService.ts')

/** Action ids the overlay actually sends via handleQuickAction('...'). */
function overlayQuickActionIds(): string[] {
  const ids = new Set<string>()
  for (const match of overlaySource.matchAll(/handleQuickAction\('([^']+)'\)/g)) {
    ids.add(match[1])
  }
  return [...ids]
}

/** Keys of ACTION_PROMPTS, which appear bare (recap:) or quoted ('follow-up':). */
function actionPromptKeys(): string[] {
  const start = claudeServiceSource.indexOf('const ACTION_PROMPTS')
  expect(start, 'ACTION_PROMPTS not found - was it renamed?').toBeGreaterThan(-1)
  const body = claudeServiceSource.slice(start, claudeServiceSource.indexOf('\n};', start))
  const keys = new Set<string>()
  for (const match of body.matchAll(/^ {2}'?([a-z][a-z-]*)'?:\s*`/gm)) {
    keys.add(match[1])
  }
  return [...keys]
}

describe('overlay quick actions <-> ACTION_PROMPTS', () => {
  it('finds quick actions in the overlay', () => {
    // Guards the regex itself: if the call shape changes, the checks below
    // would vacuously pass over an empty list.
    expect(overlayQuickActionIds().length).toBeGreaterThan(0)
  })

  it('finds keys in ACTION_PROMPTS', () => {
    expect(actionPromptKeys().length).toBeGreaterThan(0)
  })

  it('every quick action the overlay sends is a real ACTION_PROMPTS key', () => {
    const keys = actionPromptKeys()
    for (const id of overlayQuickActionIds()) {
      expect(
        keys,
        `overlay sends "${id}", which is not an ACTION_PROMPTS key - it would silently fall back to assist`,
      ).toContain(id)
    }
  })

  it('every quick action has a display label in getActionLabel', () => {
    // Without a case there the response badge falls through to a default, so
    // the user cannot tell which action produced which answer.
    for (const id of overlayQuickActionIds()) {
      expect(
        claudeServiceSource.includes(`case '${id}':`),
        `"${id}" has no label case in claudeService.getActionLabel`,
      ).toBe(true)
    }
  })
})
