import Store from 'electron-store';
import { app, safeStorage } from 'electron';
import { createHash } from 'crypto';
import { hostname, userInfo } from 'os';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

function getEncryptionKey(): string {
  // Derive a deterministic per-machine key from OS-level identifiers.
  // This is obfuscation (not true security) since the derivation is deterministic,
  // but it prevents trivial decryption by someone who just reads the source code.
  // We intentionally avoid safeStorage here because:
  //   - safeStorage.encryptString() is non-deterministic (random IV each call)
  //   - It changes across Electron major versions, breaking existing configs
  //   - It triggers macOS Keychain permission prompts on upgrade
  const machineId = `${hostname()}-${userInfo().username}-raven-v1`;
  return createHash('sha256').update(machineId).digest('hex').slice(0, 32);
}

export interface LocalSettings {
  // Plan mode
  mode: 'free' | 'pro';

  // API Keys (BYOK — all modes)
  deepgramApiKey: string;
  anthropicApiKey: string;
  assemblyaiApiKey: string;
  recallApiKey: string;
  recallApiUrl: string;
  apiKeysConfigured: boolean;

  // Onboarding
  onboardingComplete: boolean;
  /** Wizard index so a permission relaunch resumes instead of starting over. */
  onboardingStep: number;
  proOnboardingComplete: boolean;
  proOnboardingStep: string;

  // Window state
  dashboardBounds: { x: number; y: number; width: number; height: number } | null;
  overlayBounds: { x: number; y: number; width: number; height: number } | null;

  // Preferences
  stealthEnabled: boolean;
  /**
   * Overlay-first UX. When false (default) the dashboard never opens by
   * itself: launch goes straight to the overlay + tray, and the dashboard
   * is only shown when the user asks for it (tray, or the overlay's
   * Dashboard button). First run still shows it so onboarding is reachable.
   */
  showDashboardOnLaunch: boolean;
  /**
   * When false (default) ending a session does not raise the dashboard.
   * The old behavior popped a window and stole focus on every stop —
   * including transcription failures mid-call. See audioManager.
   */
  showDashboardOnSessionEnd: boolean;
  /**
   * Cursor behaviour over the overlay. Content protection hides the overlay's
   * pixels from a capture but NOT the mouse cursor, which the capturer draws
   * itself - so a pointer turning into a hand over an invisible button is a
   * visible tell. 'neutral' (default) pins a plain arrow; 'hidden' removes the
   * cursor entirely while over the overlay; 'off' restores normal affordances.
   */
  /**
   * Overlay window opacity, 0.3..1 (0.3..0.99 on macOS). Clamped by
   * clampOverlayOpacity in src/shared/overlayOpacity.ts, which floors it so the
   * overlay can never become invisible-but-clickable.
   */
  overlayOpacity: number;
  theme: 'light' | 'dark' | 'system';
  openOnLogin: boolean;
  transcriptionLanguage: string;
  /** Which STT engine to try. `auto` follows language routing. */
  sttProvider: 'auto' | 'assemblyai' | 'deepgram';
  /**
   * Capture the system/loopback audio stream (i.e. the other party on a call).
   *
   * Was read by systemAudioNative.ts and written by the dashboard's Audio tab
   * while being declared NOWHERE - not in this interface, not in
   * STORE_DEFAULTS, not in getAllSettings. It happened to behave because
   * store.get() returned undefined and the read sites test `!== false`, so the
   * default was "on" purely by accident. Declared so it has a real default and
   * appears in getAllSettings like every other setting.
   */
  captureSystemAudio: boolean;
  /**
   * Answer questions from the other party without being asked to.
   *
   * On by default: needing to press a button every time someone asks you
   * something defeats the point during a live call. The policy that decides
   * when to fire is in renderer/lib/autoAnswer.ts - it only ever reacts to the
   * SYSTEM stream, never the microphone, so it cannot answer the user's own
   * speech back to them.
   */
  autoAnswer: boolean;
  outputLanguage: string;
  // User's custom vocabulary for transcription (comma-separated string
  // stored locally, parsed into string[] when passed to the backend as
  // keyterms). See F1 in docs/LAUNCH_V2_1_PLAN.md. The backend always
  // prepends "Raven" + dedupes + caps at 100, so this value is the
  // user's additions only (not the brand term itself).
  vocabulary: string;

  // AI Provider — live assist (overlay Assist / What should I say / Recap)
  aiProvider: 'anthropic' | 'openai';
  aiModel: string;
  aiEffort: string;
  /**
   * Optional OpenAI-compatible base URL for the 'openai' provider. Empty =
   * api.openai.com. Set it to reach Gemini, Groq, OpenRouter, DeepSeek or a
   * local Ollama with the existing provider:
   *   https://generativelanguage.googleapis.com/v1beta/openai
   *   https://api.groq.com/openai/v1
   *   http://127.0.0.1:11434/v1
   * When set, aiModel is passed through verbatim (the OpenAI model catalog
   * does not apply) and reasoning-effort params are suppressed.
   */
  aiBaseUrl: string;
  /**
   * Notes slot (title, summary, insights). Empty = follow assist provider's
   * cheap default (Haiku / Luna). See src/shared/aiSlots.ts.
   */
  notesProvider: '' | 'anthropic' | 'openai';
  notesModel: string;
  notesEffort: string;
  openaiApiKey: string;

  /**
   * Auto-start on meeting detection. 'off' disables detection entirely,
   * 'prompt' shows a non-intrusive "start Raven?" toast, 'auto' starts a
   * session automatically. No meeting bot; capture stays local either way.
   */
  meetingAutoStart: 'off' | 'prompt' | 'auto';

  // Active mode
  activeModeId: string | null;

  // User profile
  displayName: string;
  profilePicturePath: string;

  /** Last Mac DMG version the user tapped Later on. Empty = never dismissed. */
  macUpdateDismissedVersion: string;

  // Pro extensions store arbitrary keys via saveSetting()
  // (e.g. auth_tokens, auth_user, sync_queue, backendUrl)
  [key: string]: unknown;
}

const STORE_DEFAULTS: LocalSettings = {
  mode: 'free',
  deepgramApiKey: '',
  anthropicApiKey: '',
  assemblyaiApiKey: '',
  recallApiKey: '',
  recallApiUrl: 'https://ap-northeast-1.recall.ai',
  apiKeysConfigured: false,
  onboardingComplete: false,
  onboardingStep: 1,
  proOnboardingComplete: false,
  proOnboardingStep: '',
  dashboardBounds: null,
  overlayBounds: null,
  // Default ON. This fork exists to answer questions during a call without the
  // other party seeing it, and stealthEnabled is the single flag that decides
  // whether the windows are excluded from screen capture. Shipping it off meant
  // a fresh install was fully capturable during exactly the scenario it is for,
  // and nothing in onboarding turned it on - only a manual click on the eye in
  // the controller pill ever wrote this key. The eye is still a one-click
  // reversal for anyone who wants to demo or record the app itself.
  stealthEnabled: true,
  showDashboardOnLaunch: false,
  showDashboardOnSessionEnd: false,
  overlayOpacity: 1,
  theme: 'system',
  openOnLogin: false,
  transcriptionLanguage: 'en',
  sttProvider: 'auto',
  // On: hearing the other side of the call is the entire point of the app.
  captureSystemAudio: true,
  autoAnswer: true,
  outputLanguage: 'en',
  vocabulary: '',
  aiProvider: 'anthropic',
  aiModel: 'claude-haiku-4-5',
  aiEffort: 'low',
  aiBaseUrl: '',
  notesProvider: '',
  notesModel: '',
  notesEffort: '',
  openaiApiKey: '',
  meetingAutoStart: 'prompt',
  activeModeId: null,
  displayName: '',
  profilePicturePath: '',
  macUpdateDismissedVersion: '',
};

function createStore(): Store<LocalSettings> {
  const encryptionKey = getEncryptionKey();
  try {
    const s = new Store<LocalSettings>({
      name: 'raven-config',
      defaults: STORE_DEFAULTS,
      encryptionKey,
    });
    // Verify we can read (triggers decryption)
    s.get('mode');
    return s;
  } catch {
    // Decryption failed (e.g. encryption key changed).
    // Delete the corrupted config file and start fresh.
    try {
      const configPath = join(app.getPath('userData'), 'raven-config.json');
      if (existsSync(configPath)) unlinkSync(configPath);
    } catch {
      // ignore - file may not exist or be locked
    }
    return new Store<LocalSettings>({
      name: 'raven-config',
      defaults: STORE_DEFAULTS,
      encryptionKey,
    });
  }
}

const store = createStore();

// Clean up stale unencrypted config.json left by a previous bug
// where `new Store()` was used without the encryption key.
// This file contains plaintext API keys and must be removed.
try {
  const legacyConfigPath = join(app.getPath('userData'), 'config.json');
  if (existsSync(legacyConfigPath)) {
    unlinkSync(legacyConfigPath);
  }
} catch {
  // ignore - file may not exist or be locked
}

// ---- Getters ----

export function getStore(): Store<LocalSettings> {
  return store;
}

export function getAllSettings(): LocalSettings {
  // API keys are omitted on purpose. store:get-all is used for boot
  // flags and General settings — never for secrets. Use store:get /
  // getApiKey for a single decrypted key.
  return {
    mode: store.get('mode'),
    deepgramApiKey: '',
    anthropicApiKey: '',
    assemblyaiApiKey: '',
    recallApiKey: '',
    recallApiUrl: store.get('recallApiUrl'),
    apiKeysConfigured: store.get('apiKeysConfigured'),
    onboardingComplete: store.get('onboardingComplete'),
    onboardingStep: store.get('onboardingStep'),
    dashboardBounds: store.get('dashboardBounds'),
    overlayBounds: store.get('overlayBounds'),
    stealthEnabled: store.get('stealthEnabled'),
    showDashboardOnLaunch: store.get('showDashboardOnLaunch'),
    showDashboardOnSessionEnd: store.get('showDashboardOnSessionEnd'),
    overlayOpacity: store.get('overlayOpacity'),
    theme: store.get('theme'),
    openOnLogin: store.get('openOnLogin'),
    transcriptionLanguage: store.get('transcriptionLanguage'),
    sttProvider: store.get('sttProvider'),
    captureSystemAudio: store.get('captureSystemAudio'),
    autoAnswer: store.get('autoAnswer'),
    outputLanguage: store.get('outputLanguage'),
    vocabulary: store.get('vocabulary'),
    aiProvider: store.get('aiProvider'),
    aiModel: store.get('aiModel'),
    aiEffort: store.get('aiEffort'),
    aiBaseUrl: store.get('aiBaseUrl'),
    notesProvider: store.get('notesProvider'),
    notesModel: store.get('notesModel'),
    notesEffort: store.get('notesEffort'),
    openaiApiKey: '',
    meetingAutoStart: store.get('meetingAutoStart'),
    activeModeId: store.get('activeModeId'),
    displayName: store.get('displayName'),
    profilePicturePath: store.get('profilePicturePath'),
    macUpdateDismissedVersion: store.get('macUpdateDismissedVersion'),
    proOnboardingComplete: store.get('proOnboardingComplete'),
    proOnboardingStep: store.get('proOnboardingStep'),
    cachedUserProfile: store.get('cachedUserProfile' as keyof LocalSettings) || null,
    cachedSubscription: store.get('cachedSubscription' as keyof LocalSettings) || null,
  };
}

export function getSetting<K extends keyof LocalSettings>(key: K): LocalSettings[K] {
  if ((API_KEY_FIELDS as readonly string[]).includes(key as string)) {
    return getApiKey(key as typeof API_KEY_FIELDS[number]) as LocalSettings[K];
  }
  return store.get(key);
}

// ---- Setters ----

export function saveSetting<K extends keyof LocalSettings>(
  key: K,
  value: LocalSettings[K]
): void {
  if ((API_KEY_FIELDS as readonly string[]).includes(key as string) && typeof value === 'string') {
    store.set(key, encryptValue(value));
    return;
  }
  store.set(key, value);
}

export function saveSettings(settings: Partial<LocalSettings>): void {
  Object.entries(settings).forEach(([key, value]) => {
    store.set(key as keyof LocalSettings, value);
  });
}

// ---- Secure storage helpers for API keys ----

const API_KEY_FIELDS = [
  'deepgramApiKey',
  'anthropicApiKey',
  'openaiApiKey',
  'assemblyaiApiKey',
  'recallApiKey',
] as const;

function encryptValue(value: string): string {
  if (!value) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(value).toString('base64');
    }
  } catch { /* fall through */ }
  return value;
}

function decryptValue(stored: string): string {
  if (!stored) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    }
  } catch { /* fall through - may be an unencrypted legacy value */ }
  return stored;
}

export function getApiKey(key: typeof API_KEY_FIELDS[number]): string {
  const raw = store.get(key) as string;
  return decryptValue(raw);
}

// ---- API Key Helpers ----

export function saveApiKeys(
  deepgramKey: string,
  anthropicKey: string,
  openaiKey?: string,
  extras?: { assemblyaiApiKey?: string; recallApiKey?: string },
): void {
  store.set('deepgramApiKey', encryptValue(deepgramKey));
  store.set('anthropicApiKey', encryptValue(anthropicKey));
  if (openaiKey !== undefined) {
    store.set('openaiApiKey', encryptValue(openaiKey));
  }
  if (extras?.assemblyaiApiKey !== undefined) {
    store.set('assemblyaiApiKey', encryptValue(extras.assemblyaiApiKey));
  }
  if (extras?.recallApiKey !== undefined) {
    store.set('recallApiKey', encryptValue(extras.recallApiKey));
  }
  store.set('apiKeysConfigured', true);
}

/**
 * Set ONE AI provider key, leaving every other key untouched.
 *
 * saveApiKeys() overwrites deepgramApiKey and anthropicApiKey
 * unconditionally, and the renderer cannot read keys back to pass them
 * through (getAllSettings blanks all secrets by design). So a caller that
 * only wants to set the OpenAI key - e.g. the overlay's AI settings panel
 * pointing at Gemini - had no safe way to do it: it would have wiped the
 * user's Deepgram key as a side effect. This is that safe path.
 */
export function saveAiProviderKey(provider: 'anthropic' | 'openai', key: string): void {
  const field = provider === 'openai' ? 'openaiApiKey' : 'anthropicApiKey';
  store.set(field, encryptValue(key));
  // Only flip the boot flag when the app genuinely has what it needs (an STT
  // key AND the active provider's AI key). hasApiKeys() is the real test;
  // setting it here unconditionally would let onboarding be skipped with no
  // transcription key configured.
  if (hasApiKeys()) {
    store.set('apiKeysConfigured', true);
  }
}

export function hasApiKeys(): boolean {
  const hasStt = !!getApiKey('deepgramApiKey') || !!getApiKey('assemblyaiApiKey');
  const provider = store.get('aiProvider') || 'anthropic';
  const hasAiKey = provider === 'openai'
    ? !!getApiKey('openaiApiKey')
    : !!getApiKey('anthropicApiKey');
  return hasStt && hasAiKey;
}

export function clearApiKeys(): void {
  store.set('deepgramApiKey', '');
  store.set('anthropicApiKey', '');
  store.set('openaiApiKey', '');
  store.set('assemblyaiApiKey', '');
  store.set('recallApiKey', '');
  store.set('apiKeysConfigured', false);
}

// ---- Plan Helpers ----

export function isFreeMode(): boolean {
  return true
}

/** Hosted Pro is gone. Always false so a leftover caller cannot enable it. */
export function isProMode(): boolean {
  return false
}

// ---- Reset ----

export function resetAll(): void {
  store.clear();
}
