/**
 * Which global shortcuts the OS refused us.
 *
 * globalShortcut.register() is first-come-first-served across the whole
 * machine: if another app already holds an accelerator, our registration
 * returns false and the key silently does nothing. For a tool whose primary
 * way in IS the hotkey, that reads as "the app is broken" - the user presses
 * Ctrl+\ and no window appears, with nothing anywhere explaining why.
 *
 * Registration happens in index.ts and is read over IPC by the renderer, so the
 * state lives in its own module rather than being exported from index.ts, which
 * ipc.ts cannot import without creating a cycle.
 */

let unavailable: string[] = []

/** Replaces the recorded set. Called once after registration. */
export function setUnavailableShortcuts(accelerators: readonly string[]): void {
  unavailable = [...accelerators]
}

export function getUnavailableShortcuts(): string[] {
  return [...unavailable]
}

/**
 * Picks out the accelerators that failed from a label -> ok map, preserving
 * insertion order so the message lists them the way they are documented.
 */
export function collectUnavailable(results: ReadonlyArray<readonly [string, boolean]>): string[] {
  return results.filter(([, ok]) => !ok).map(([accelerator]) => accelerator)
}
