import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * A native `title` attribute is a screen-capture leak.
 *
 * Chromium renders a title tooltip as a separate OS-level window, outside the
 * BrowserWindow's composited surface - so setContentProtection does not hide
 * it. Hovering a control therefore paints text onto a shared screen even though
 * the window itself is excluded. This is the same failure class as the model
 * dropdown, which was a native <select> for the same reason.
 *
 * It matters more now that stealthEnabled defaults on and the dashboard is
 * content-protected too: these were the last remaining native tooltips.
 *
 * Source-scanned rather than DOM-tested because the offenders lived in an HTML
 * string injected via executeJavaScript, which no renderer test would see.
 */

const SCANNED = [
  'src/main/windowManager.ts',
  'src/renderer/src/components/overlay/OverlayWindow.tsx',
  'src/renderer/src/components/overlay/ControllerPill.tsx',
  'src/renderer/src/components/overlay/AiSettingsPopover.tsx',
  'src/renderer/src/components/overlay/ModePicker.tsx',
  'src/renderer/src/components/overlay/OverlaySizePicker.tsx',
]

/** `title=` as an attribute. Excludes `<title>` and object keys like `title:`. */
const TITLE_ATTRIBUTE = /\btitle\s*=\s*["'{]/g

describe('no native tooltips on capture-protected surfaces', () => {
  it.each(SCANNED)('%s declares no title attribute', (relative) => {
    const source = readFileSync(join(process.cwd(), relative), 'utf8')
    const hits = source.match(TITLE_ATTRIBUTE) ?? []
    expect(hits).toEqual([])
  })

  it('the scan would actually catch a regression', () => {
    // Guards the guard: a regex that matches nothing would make the assertions
    // above pass forever regardless of what the files contain.
    expect('<button title="Minimize">'.match(TITLE_ATTRIBUTE)).toHaveLength(1)
    expect('<button title={label}>'.match(TITLE_ATTRIBUTE)).toHaveLength(1)
    // And does not fire on things that are not tooltips.
    expect('<title>Raven</title>'.match(TITLE_ATTRIBUTE)).toBeNull()
    expect('{ title: "Live assist" }'.match(TITLE_ATTRIBUTE)).toBeNull()
  })
})
