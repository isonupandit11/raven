# Raven → Pluely UX Parity Plan

Working plan for `feature/pluely-ux-and-gemini`. Goal: raven gains Pluely's
overlay-first usability and feature surface, while keeping raven's advantages
(MIT source, Alt-Tab stealth, streaming Deepgram, unlimited local knowledge
files, real test suite).

**Target platform:** Windows 11 (build 26200). macOS paths left untouched.

---

## Legal boundaries (non-negotiable)

- **Pluely v1 is proprietary, closed-source.** No code to copy, and none will be.
- **Pluely's pre-v1 repo is GPL-3.0.** Raven is MIT. Copying GPL code in would
  force the whole project to GPL. Not doing it.
- **What we replicate:** features and functional layout (what control sits
  where). Written originally, styled with raven's existing Tailwind system.
- **What we do not replicate:** Pluely's visual identity, icon set, brand
  wording, or logo.

Source of truth for the feature list: docs.pluely.com + the pricing page +
the user's own screenshot of the v1 overlay.

---

## Audit correction (read this before building anything)

The first inventory below was built from the preload API surface and component
filenames, not from reading `OverlayWindow.tsx` (1326 lines). It **over-claimed
missing features**. Verified position, by listing every `window.raven.*` the
overlay actually calls:

**Already implemented — do not rebuild:**

- **Quick-action chips.** Assist, What should I say?, Follow-ups, Recap, Tell me
  more — all present, gated on `isRecording`. An earlier grep for `action: '`
  missed them because `handleQuickAction` passes the id as a variable. A
  duplicate lib was started and deleted; only the drift test remains.
- **Screen context.** `includeScreenshot` is passed to `claudeGetResponse` and
  the screenshot is taken in the main process, so Assist already sees the
  screen. What is missing is a *manual* capture button, not the capability.
- Overlay drag, resize, mouse passthrough, stealth toggle, transcript/response
  tabs, hotkeys (toggle recording, move, scroll, clear, AI suggestion).

**Genuinely missing** (confirmed absent from the overlay's call list):

| Item | Needs |
|---|---|
| History / sessions browsing | UI only — `sessions.*` is already in preload |
| Manual screenshot + region crop buttons | region crop needs a `cropper:*` IPC |
| File attach / RAG from the overlay | IPC — no `rag`/`documents` namespace exists in preload at all |
| Push-to-talk (hold) | new hotkey + IPC; only a toggle exists |
| Auto-responses trigger control | main-process logic (question/pause detection policy) |
| Window transparency slider | setting + main + UI |
| Always-on-top toggle | setting + UI (currently always on, not user-facing) |

Beware `rag` as a search pattern — it matches "D**rag**" throughout
`useOverlayDrag`, which is what produced the bad first audit.

## Feature inventory

Legend — **UI**: pure renderer work, capability already in preload.
**IPC**: needs a small main-process addition. **NEW**: real new capability.

### Overlay composer / toolbar

| # | Pluely feature | Raven today | Type | Est |
|---|---|---|---|---|
| 1 | Mode / prompt-preset picker | `modes.*` IPC ready, no UI | UI | 120 |
| 2 | Model picker | `MODEL_CATALOG` + `storeSet` ready | UI | 100 |
| 3 | Size presets S / M / L / XL | `windowAutoSizeOverlay`, `windowSetOverlayBounds` | UI | 90 |
| 4 | History / sessions access | `sessions.getAll/search/get` ready | UI | 150 |
| 5 | Settings panel in overlay | `storeGet/Set`, `apiKeysSave`, `analyticsSetEnabled` | UI | 220 |
| 6 | Quick-action chips (What should I say / Fact-check / Recap / Follow-ups) | canned prompts over existing ask path | UI | 110 |
| 7 | Dashboard button | `windowShowDashboard` ready | UI | 10 |
| 8 | Docs link | `openExternal` ready | UI | 10 |
| 9 | Screenshot (full screen) | `desktopGetSources` exists | UI+wiring | 80 |
| 10 | Region selection capture | `CropperWindowHelper` in main, **no IPC** | IPC | 90 |
| 11 | Attach file / Library | `ragService.ts` in main, **no IPC** | IPC | 160 |
| 12 | Push-to-talk (hold) | only toggle hotkey exists | NEW | 120 |
| 13 | Auto-responses control (On questions / Every pause / Off) | Assist exists; no trigger-mode control | NEW | 200 |

### Stealth / privacy

| # | Pluely feature | Raven today | Type | Est |
|---|---|---|---|---|
| 14 | Invisible in screen share | ✅ `setContentProtection`, verified on Win11 26200 | done | — |
| 15 | Hide from taskbar | overlay ✅ / **dashboard ✗** | fix | 5 |
| 16 | Hide from Alt-Tab | ✅ `WS_EX_TOOLWINDOW` (better than Pluely) | done | — |
| 17 | **Invisible / neutral mouse cursor** | mouse passthrough only | NEW | 70 |
| 18 | Window transparency slider | not present | UI | 60 |
| 19 | Always-on-top toggle | always on, not user-facing | UI | 30 |
| 20 | Never steals focus | ✅ `windowSetOverlayFocusable` | done | — |

### Windowing / lifecycle

| # | Item | Type | Est |
|---|---|---|---|
| 21 | Dashboard must not open at launch | fix | 15 |
| 22 | Dashboard must not pop on session end | **done** | — |
| 23 | Launch on startup toggle | `openOnLogin` setting exists, no UI | UI | 25 |
| 24 | Overlay remembers size + position | `overlayBounds` exists | verify | 10 |

### Providers

| # | Item | Type | Est |
|---|---|---|---|
| 25 | Gemini support | `baseUrl` override | fix | 25 |
| 26 | Groq / OpenRouter / Ollama | free with #25 | — | 0 |
| 27 | Telemetry off switch | `analyticsSetEnabled` exists, no UI | UI | 20 |

---

## Phases

### Phase 1 — Overlay-first windowing + safety  ← IN PROGRESS

Highest value per line. Makes raven behave like an overlay tool.

- [x] **Kill the session-end popup.** `audioManager.ts` raised and focused the
      dashboard on *every* stop, including `TRANSCRIPTION_FAILED`. A dropped
      transcription mid-interview popped a window and stole focus. Now behind
      `showDashboardOnSessionEnd` (default `false`).
- [x] **Settings added.** `store.ts`: `showDashboardOnLaunch`,
      `showDashboardOnSessionEnd` — interface + defaults + `getAllSettings`.
- [ ] **Don't show dashboard at launch.** `windowManager.ts:263` `ready-to-show`
      does an unconditional `dashboardWindow?.show()`. Gate on
      `showDashboardOnLaunch`, with a first-run exception when
      `onboardingComplete` is false so onboarding stays reachable.
- [ ] **Dashboard out of taskbar + Alt-Tab.** Add `skipTaskbar: true` to its
      options (~line 185) and call the existing
      `applyOverlayToolWindowStyle(dashboardWindow)` from
      `windowsOverlayStyle.ts:67`.

### Phase 2 — Gemini + open provider routing  ← DONE (code)

- [x] `baseUrl?: string` on `AIProviderConfig` (`services/ai/types.ts`).
- [x] Threaded into `OpenAIProvider` → `new OpenAI({ apiKey, baseURL })`, via a
      `clientOptions()` helper that omits `baseURL` entirely when unset.
- [x] `baseUrl` added to `configKey()` — was
      `provider:model:effort:apiKey`, so a baseUrl change returned a **stale
      cached client** and switching endpoint appeared to do nothing.
- [x] `effort` suppressed when `baseUrl` is set. `buildOpenAIEffortParams`
      emits `reasoning_effort`, which non-OpenAI endpoints reject with a 400
      rather than ignoring.
- [x] **Model catalog bypassed on a custom endpoint.** `resolveCatalogModel()`
      returns `DEFAULT_MODELS[provider]` for any id not in `PROVIDER_MODELS`,
      so `gemini-2.5-flash` was silently swapped for an OpenAI id. The user's
      model id is now authoritative when `baseUrl` is set.
- [x] **`max_tokens` capped at 8192 on a custom endpoint.**
      `streamMaxTokensFor()` returns OpenAI ceilings up to 128k; Gemini and
      others 400 on that. Ample for a spoken answer.
- [x] `aiBaseUrl` setting (interface + default + `getAllSettings`).
- [x] 9 tests added (6 provider, 3 factory).
- [ ] Settings UI field — deferred to Phase 3 with the rest of the overlay UI.

**Correction to an earlier assumption:** no CSP change is needed. Every AI and
STT call originates in the **main process** (`openaiProvider.ts` imports the
`openai` SDK under `src/main/`; Deepgram's socket opens in
`transcriptionService.ts`), and the renderer makes no direct calls to those
hosts. Electron's `connect-src` governs renderer requests only, so the existing
allowlist at `windowManager.ts:49` is defensive and does not gate this.

Unlocks Gemini, Groq, OpenRouter, DeepSeek, local Ollama with one setting.

Usage once the UI field lands (or by editing config today):
`aiProvider = openai`, `aiBaseUrl = https://generativelanguage.googleapis.com/v1beta/openai`,
`aiModel = gemini-2.5-flash`, `openaiApiKey = <AI Studio key>`.

Deferred: a native `geminiProvider.ts`. If taken, note that adding `'gemini'`
to `AIProviderName` makes TS flag all 8 `Record<AIProviderName,…>` maps, but the
~10 two-way ternaries (`store.ts:304`, `validators.ts:205/215/220`,
`providerFactory.ts:58`, `aiSlots.ts:26`, `types.ts:108/131`) **compile fine**
and silently route Gemini to the Anthropic branch. Must be fixed by hand.

### Phase 3 — Overlay control bar  ← IN PROGRESS

Extends `OverlayToolbar.tsx` with a compact popover set, on raven's existing
Tailwind tokens.

- [x] **#1 Mode picker** (`ModePicker.tsx`). Optimistic select with rollback,
      subscribes to `modes.onListUpdated`, closes on outside click / Escape.
- [x] **#5 Settings popover** (`AiSettingsPopover.tsx`) — provider, endpoint
      presets (OpenAI / Gemini / Groq / Ollama), model, API key, telemetry.
      This is what makes the Phase 2 `aiBaseUrl` plumbing actually usable;
      before it, Gemini could only be configured by editing the config file.
- [x] **#27 Telemetry toggle.** Required typing `analyticsIsEnabled` /
      `analyticsSetEnabled` in `global.d.ts` — both had been in the preload
      since analytics landed but were never typed, which is exactly why
      `analytics.ts` says "no in-app UI exposes it".
- [x] **Safe single-key write** (not originally planned). `saveApiKeys()`
      overwrites `deepgramApiKey` and `anthropicApiKey` unconditionally and
      secrets cannot be read back, so an overlay key field built on it would
      have silently destroyed the user's STT key. Added
      `saveAiProviderKey` + `store:save-ai-key` + `window.raven.aiKeySave`.
- [ ] #2 Model picker in the toolbar (model is settable in the popover today;
      a one-tap picker beside the mode picker is still wanted).
- [ ] #3 Size presets S/M/L/XL
- [ ] #4 History / sessions
- [ ] #6 Quick-action chips
- [ ] #7 Dashboard button · #8 Docs link

**Testing note:** vitest here runs `environment: 'node'` and includes only
`*.test.ts` under `main/`, `main/services/` and `renderer/src/lib/` — no jsdom
or testing-library. Upstream's convention is unit-testing pure logic and
covering UI through the Playwright e2e suite, so these components are verified
by full-project `tsc` + `eslint --max-warnings 0` rather than component tests.

### Phase 4 — Capture + attach

Items 9, 10, 11. Needs three IPC additions:
`cropper:open`, `rag:attach`, `rag:list`. Wire to existing
`CropperWindowHelper` and `ragService`.

### Phase 5 — Cursor privacy + presentation polish

- [ ] **Item 17 — neutral/invisible cursor.** The real tell: content protection
      hides the overlay pixels, but the OS cursor is composited by the
      *capturer*, so a viewer sees the pointer glide to empty space and change
      to a hand over invisible buttons. Fix in two parts: force
      `cursor: default` (never `pointer`) across overlay interactive elements so
      hover reveals nothing, and offer `cursor: none` inside the overlay bounds.
- [ ] Items 18, 19, 23, 24.

### Phase 6 — Auto-responses

Item 13. On-device question detection over the transcript stream, with
On-questions / Every-pause / Off. Raven already has `onHotkeyAiSuggestion` and
the Assist path; this adds the trigger policy plus a UI chip.

---

## Build from source (Windows)

Per `CONTRIBUTING.md` + `src/native/windows/README.md`.

Status on this machine:

| Requirement | State |
|---|---|
| Node ≥ 22.12 | ✅ v26.5.0 |
| npm | ✅ 11.17.0 |
| Python | ✅ 3.12.10 |
| Rust (rustup, stable-msvc) | ✅ 1.98.0 |
| VS C++ workload | ✅ MSVC 14.51.36231 + Windows SDK 10.0.26100 |
| `npm install` | ✅ |
| `@napi-rs/cli` | ✅ |
| `raven-windows-audio.win32-x64-msvc.node` | ✅ built (514 KB, 24s) |
| better-sqlite3 for Electron ABI | ✅ prebuilt binary (ABI 143) |
| Electron binary | ✅ 40.9.3 |
| typecheck / lint / vitest | ✅ **1035/1035 green** |
| `npx vite build` | ✅ main + preload + renderer |
| `raven-aec.node` | ☐ optional (cmake-js); echo cancellation degrades without it |

**BUILD IS WORKING.** Three traps hit along the way, all recorded here because
they will recur on any fresh Windows machine:

1. **node-gyp cannot use Visual Studio 2026.** `find-visualstudio.js` in
   node-gyp 11.5.0 matches only `[2019, 2022]` (plus 2017), so the
   `postinstall` (`@electron/rebuild -f -w better-sqlite3`) fails with
   "Could not find any Visual Studio installation to use" even with a complete
   VS 18 C++ toolchain. **Workaround:** skip compiling entirely and fetch a
   prebuilt binary —
   `cd node_modules/better-sqlite3 && npx prebuild-install --runtime=electron --target=<electron> --arch=x64`.
   Installing VS 2022 Build Tools alongside would also work but costs GBs.

2. **`extract-zip` silently no-ops on the Electron archive** under Node 26.
   `install.js` reports a cache hit, resolves, exits 0 — and leaves `dist/`
   containing only `locales`, no `electron.exe`. The zip itself is fine (138 MB,
   75 entries, `electron.exe` 204 MB inside). **Workaround:** extract it
   directly (`[IO.Compression.ZipFile]::ExtractToDirectory`) into
   `node_modules/electron/dist`, then write `path.txt` containing
   `electron.exe`, which is all `install.js` would have done.

3. **The VS workload install needs elevation** (see below).

Gotcha worth recording: the VS workload install **requires elevation**. Run
non-elevated it silently ignores `--quiet`, opens a GUI dialog
(`processtype: ui`, `quiet: False`, `iselevated: False` in
`%TEMP%\dd_installer_*.log`) and waits for a click that never comes. There is
also **no `--wait` flag** in installer 4.8.60 — passing it fails with exit 87.

Remaining steps once MSVC lands:

```powershell
npm install                       # full, runs postinstall + electron download
npm install -g @napi-rs/cli
cd src/native/windows && napi build --platform --release
```

Note: no `.node` binaries ship in the repo, so system audio and the Alt-Tab
tool-window style both depend on compiling the Rust module. Until then the app
runs but cannot capture system audio.

---

## Verification

After every change:

```powershell
npm run typecheck:main
npm run lint          # eslint --max-warnings 0
npm run test          # tsc --noEmit && vitest run  (71 test files)
```

Expect to update tests that assert the old show-on-ready / show-on-stop
behaviour — that is a deliberate behaviour change, not a regression.

Manual checklist:

1. Launch → **no window appears**; tray + overlay only.
2. Overlay → switch mode; the next answer uses the new system prompt.
3. Share screen in Teams → overlay and dashboard both absent.
4. Taskbar and Alt-Tab → neither window listed.
5. Kill network mid-session → **no popup**, overlay shows the failure.
6. Hover overlay buttons while sharing → cursor does not change shape.
7. Ask with Gemini selected → streams an answer.

## Risks

- `sandbox: app.isPackaged` — dev runs unsandboxed. A packaged build must be
  tested separately, not just `npm run dev`.
- Dormant free-tier code exists (`audioManager.startSessionTimer`, no caller;
  Recall.ai upload builder, no caller). Harmless today; re-check after any
  upstream merge.
- Upstream is active (v2.4.3, 2026-08-28). Rebase before large phases.

---

## Status review — 2026-09-02

34 commits from the fork point (`212e0a9`). Gate: **1239 tests / 80 files,
eslint 0, tsc 0.** A Windows installer builds and the packaged app was smoke
tested (DB init, hotkeys all registered, tray, meeting detection).

### Upstream / fork survey

- **Upstream `Laxcorp-Research/project-raven`: 0 commits ahead** of our fork
  point. Nothing to merge.
- **Forks: 100 surveyed, 5 pushed after creation, 2 actually ahead.**
  - `markrod828` (+2) — `max_tokens` -> `max_completion_tokens`. **Taken**,
    adapted: their version is unconditional on the premise that
    `resolveCatalogModel` clamps the model to OpenAI's catalog, which is false
    here because providerFactory bypasses it for custom endpoints. Keyed on the
    endpoint instead. Their other commits are committed build artifacts
    (`target/`, `Cargo.lock`, the `.node` binary) — not wanted.
  - `Dev-develope` (+1) — "added 60DB sevices". Unrelated.
  - Everything else is behind and empty.

### Done since the original plan was written

Beyond the phase checkboxes below, these were found and fixed while testing —
mostly failures that were *silent*, which is why they were not in the plan:

- **Transcription was dead.** AssemblyAI v2 `RealtimeTranscriber` +
  `/v2/realtime/token`, an endpoint AssemblyAI retired (404, not 401). Migrated
  to the v3 `StreamingTranscriber` the installed SDK already ships, dropping the
  whole temporary-token subsystem — tokens exist so a browser can avoid holding
  the key, and this runs in main. v3's turn model needed care: `formatTurns`
  ends a turn twice, and finalizing both duplicates the sentence because
  `handleFinalTranscript` merges same-speaker entries.
- **Permanent STT failures were retried.** "Unauthorized Connection:
  Insufficient funds" was retried 5x per stream across 2 streams, then reported
  as a generic "all providers failed". Classified now; the provider's own
  diagnosis is repeated verbatim.
- **The model invented an interviewer's question** when asked "What should I
  say?" with no transcript: `buildTranscriptBlock` returns `''`, but the prompt
  still said "based on `<transcript>`", so the model supplied the section.
  Transcript-dependent actions now refuse before any provider call.
- **Prompt scaffolding leaked into answers** (`<transcript> </transcript>`
  rendered in the bubble). Stripped in main so the clipboard, history and the
  notes prompts are clean too.
- **A native `<select>` was a capture leak.** Chromium renders it as an OS popup
  outside the protected surface; it also rendered white-on-white, so a 10-model
  catalog looked like one entry.
- **Stored stealth was ignored at launch** — the only boot-time
  `setStealthMode(true)` sat behind `app.isPackaged`, so the pill could show
  "Undetectable" over a fully capturable window. `stealthEnabled` now defaults
  on and is applied at window creation.
- **Size presets resized the wrong object** — the fullscreen overlay *window*
  instead of the panel inside it, which is why dragging broke afterwards.
- **Provider/endpoint/model drifted between two screens.** Opening the
  dashboard's Models tab rewrote a Gemini model to an OpenAI id *on load*.
  `lib/aiEndpoints.ts` is now the single definition, used by both.
- **Only live assist honoured the endpoint.** Notes, session memory and fast
  all built OpenAI clients with no base URL, carrying the Gemini key to
  api.openai.com.
- **A misplaced test file never ran.** vitest's `include` was three exact
  directories; it is recursive now.
- **`captureSystemAudio` was declared nowhere** yet read and written, working
  only because `undefined !== false`.

### Remaining, in priority order

1. **Fetch-list parity for the Notes slot.** Notes takes a free model id on a
   custom endpoint but has no "Fetch list" button of its own; it borrows the
   live slot's fetched ids only via the datalist on that screen.
2. **History / sessions in the overlay** (plan item #4). Sessions are stored and
   the dashboard shows them; the overlay cannot browse them.
3. **Capture + attach** (Phase 4, items 9/10/11) — `cropper:open`, `rag:attach`,
   `rag:list`. PDF attach works from the dashboard; region-crop does not exist.
4. **Push-to-talk hold** and an **always-on-top toggle** (items 18/19/23/24).
5. **Auto-answer modes.** Shipped as on/off; the plan wanted
   On-questions / Every-pause / Off. Every-pause is not implemented.
6. **AssemblyAI key validation still probes `/v2/account`**, so onboarding can
   call a key "valid" that then fails streaming on funds — the same
   misattribution class as the OpenAI one, still open.
7. **Auto-update has no channel.** The local installer ships without
   `app-update.yml`; the error is now handled gracefully rather than shown as a
   failure, but updating means reinstalling until a publish target exists.
8. **Five native `title` tooltips** remain in the dashboard's injected window
   controls (`windowManager.ts`). Native tooltips are separate OS windows and
   therefore outside content protection — now that stealth defaults on and the
   dashboard is protected too, these are a real leak.
9. **AEC is the JS `residualEchoGate` only.** `raven-aec.node` and the GStreamer
   bundle are not built on this machine, so webrtcdsp echo cancellation is off
   in both dev and the installer.

### Explicitly decided against

- **Pointer-lock synthetic cursor.** Verified feasible by probe (lock succeeds
  with no gesture once the window has OS focus; programmatic exit works, no Esc
  needed). Rejected because it *requires* focus, and focus change is detection
  vector #1 in the only fork that studied this (`alt-auraai`'s stealth guide),
  ranked above screen recording. Keyboard access to every control was shipped
  instead, which moves no cursor at all.
- **Cursor mode as a setting.** "Normal" only re-enabled the leak and "Hidden"
  hid the pointer from the user too. One sensible value is not a setting.
