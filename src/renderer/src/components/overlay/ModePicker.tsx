import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createLogger } from '../../lib/logger'
import {
  resolveDropdownPlacement,
  availableDropdownHeight,
  type DropdownPlacement,
} from '../../lib/dropdownPlacement'
import type { Mode } from '../../types/global'

const log = createLogger('ModePicker')

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties

/** Was Tailwind's max-h-64. Kept as a number so placement can reason about it. */
const MAX_LIST_HEIGHT = 256

/**
 * Mode (prompt preset) picker for the overlay.
 *
 * Switching the active mode previously meant opening the dashboard, which
 * defeats an overlay whose whole point is not putting a window on screen. The
 * IPC was already exposed to every renderer (window.raven.modes.*), so this is
 * UI only — no main-process change.
 *
 * The active mode decides the system prompt used by Assist, so this is the
 * single most useful control to have without leaving the overlay.
 */
export function ModePicker(): React.JSX.Element | null {
  const [modes, setModes] = useState<Mode[]>([])
  const [active, setActive] = useState<Mode | null>(null)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [placement, setPlacement] = useState<DropdownPlacement>('below')
  const [maxHeight, setMaxHeight] = useState(MAX_LIST_HEIGHT)

  // Measured on open (and on resize while open) rather than once on mount: the
  // overlay panel is draggable and resizable, so the space under the trigger
  // is only known at the moment the list is actually shown.
  useEffect(() => {
    if (!open) return
    const measure = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const next = resolveDropdownPlacement(rect, MAX_LIST_HEIGHT, window.innerHeight)
      setPlacement(next)
      setMaxHeight(Math.min(MAX_LIST_HEIGHT, availableDropdownHeight(rect, next, window.innerHeight)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  const refresh = useCallback(async () => {
    try {
      const [all, current] = await Promise.all([
        window.raven.modes.getAll(),
        window.raven.modes.getActive(),
      ])
      setModes(all)
      setActive(current)
    } catch (err) {
      log.error('Failed to load modes:', err)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Fires when modes change elsewhere (dashboard editor, or a sync pull), so
    // the overlay list does not go stale behind the user's back.
    const unsub = window.raven.modes.onListUpdated(() => {
      void refresh()
    })
    return unsub
  }, [refresh])

  // Ctrl+Shift+M. Subscribed here rather than plumbed down from OverlayWindow so
  // that the component owning `open` is the one that responds - no second
  // source of truth to drift. The point of a shortcut is that the cursor never
  // enters the overlay: content protection hides the panel's pixels from a
  // capture, but the pointer is drawn by the capturer, so reaching for this
  // control with the mouse makes a viewer watch the cursor travel into blank
  // space and click nothing.
  useEffect(() => {
    return window.raven.onHotkeyOpenModePicker(() => {
      setOpen((v) => !v)
      void refresh()
    })
  }, [refresh])

  // Close on outside click / Escape. Without this the popover survives a click
  // into the transcript and covers it.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  const select = useCallback(
    async (mode: Mode) => {
      setOpen(false)
      if (mode.id === active?.id) return
      // Optimistic: the label updates immediately, then we reconcile. A failed
      // setActive would otherwise leave the UI claiming a mode that isn't live.
      const previous = active
      setActive(mode)
      try {
        const ok = await window.raven.modes.setActive(mode.id)
        if (!ok) {
          setActive(previous)
          log.error('setActive returned false for mode', mode.id)
          return
        }
        void refresh()
      } catch (err) {
        setActive(previous)
        log.error('Failed to set active mode:', err)
      }
    },
    [active, refresh],
  )

  if (modes.length === 0) return null

  return (
    <div ref={rootRef} className="relative" style={NO_DRAG} data-overlay-interactive="">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={active ? `Mode: ${active.name}` : 'Choose a mode'}
        className="flex items-center gap-1 max-w-[7.5rem] px-2 py-1 rounded-lg text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#4169E1]"
      >
        {active?.icon ? <span aria-hidden="true">{active.icon}</span> : null}
        <span className="truncate">{active?.name ?? 'Mode'}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Modes"
          className={`absolute left-0 z-50 min-w-[12rem] overflow-y-auto rounded-lg border border-white/15 bg-[#1c1b21]/95 backdrop-blur shadow-xl py-1 ${
            placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
          style={{ maxHeight: `${maxHeight}px` }}
        >
          {modes.map((mode) => {
            const isActive = mode.id === active?.id
            return (
              <button
                key={mode.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => void select(mode)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  isActive ? 'text-white bg-[#4169E1]/20' : 'text-white/60 hover:text-white hover:bg-white/10'
                }`}
              >
                {mode.icon ? <span aria-hidden="true">{mode.icon}</span> : null}
                <span className="truncate flex-1">{mode.name}</span>
                {isActive ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
