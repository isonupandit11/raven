import { type CSSProperties } from 'react'
import {
  OVERLAY_SIZE_ORDER,
  OVERLAY_SIZES,
  matchOverlaySize,
  type OverlaySize,
  type OverlayDimensions,
} from '../../lib/overlaySizes'

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties

interface OverlaySizePickerProps {
  /** The panel's current rendered size, used to derive the active preset. */
  current: OverlayDimensions
  /** Applies a preset. The owner clamps it against the viewport. */
  onSelect: (dimensions: OverlayDimensions) => void
}

/**
 * S / M / L / XL presets for the overlay PANEL.
 *
 * Deliberately prop-driven and IPC-free. The first version owned its own state
 * and drove window:set-overlay-bounds, which resized the fullscreen overlay
 * BrowserWindow rather than the panel drawn inside it: the window jumped to the
 * preset's corner and dragging stopped working afterwards, because
 * useOverlayDrag clamps the panel against window.innerWidth/Height and those
 * had just collapsed to the preset size. Panel geometry lives in
 * useOverlayResize, so this component reads and writes that and nothing else -
 * which also means a drag-resize and a preset click can never disagree about
 * the current size.
 *
 * The active preset is derived from `current` rather than remembered, so a
 * manual drag-resize leaves nothing highlighted instead of the UI continuing to
 * claim whichever preset was clicked last.
 */
export function OverlaySizePicker({
  current,
  onSelect,
}: OverlaySizePickerProps): React.JSX.Element {
  const active: OverlaySize | null = matchOverlaySize(current)

  return (
    <div
      className="flex items-center gap-0.5"
      style={NO_DRAG}
      role="group"
      aria-label="Overlay size"
    >
      {OVERLAY_SIZE_ORDER.map((size) => (
        <button
          key={size}
          type="button"
          onClick={() => onSelect(OVERLAY_SIZES[size])}
          aria-pressed={active === size}
          aria-label={`Overlay size ${size}`}
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#4169E1] ${
            active === size
              ? 'bg-[#4169E1]/25 text-white'
              : 'text-white/40 hover:text-white hover:bg-white/10'
          }`}
        >
          {size}
        </button>
      ))}
    </div>
  )
}
