/**
 * Should Raven answer, unprompted, what the other party just said?
 *
 * The point of the app is help during a live call, and reaching for a button
 * every time someone asks you something is exactly the moment you cannot spare.
 * But firing on every transcript event would be worse than useless: it would
 * answer half-finished sentences, answer the user's own speech, and spend an API
 * request on "Okay." - during a call, where each wasted call is also latency in
 * front of the one that matters.
 *
 * So the policy is deliberately narrow and pure, so every rule below is
 * inspectable and tested rather than being emergent behaviour of a live system.
 */

export interface AutoAnswerInput {
  /** 'them' is the system/loopback stream; 'you' is the microphone. */
  speaker: 'you' | 'them'
  text: string
  isFinal: boolean
  enabled: boolean
  /** A request is already running. */
  busy: boolean
  now: number
  lastFiredAt: number | null
}

export interface AutoAnswerDecision {
  fire: boolean
  /** Why, for logging - a silent auto-feature is impossible to debug. */
  reason: string
}

/**
 * Gap between automatic answers.
 *
 * A speaker ends several turns in quick succession ("So tell me about X." /
 * "Take your time." / "Whenever you're ready."), and each one is a final
 * transcript. Without a cooldown a single question costs three requests and the
 * answers race each other into the panel.
 */
export const AUTO_ANSWER_COOLDOWN_MS = 8_000

/** Below this it is an acknowledgement, not a question. */
export const AUTO_ANSWER_MIN_WORDS = 3

/**
 * Cues that may appear ANYWHERE in the sentence.
 *
 * Real speech does not put the interrogative first. The transcript that
 * prompted this feature read "I so tell me what is dependency injection is" -
 * a start-anchored match would have ignored it.
 */
const ANYWHERE_CUES = [
  'tell me',
  'explain',
  'describe',
  'walk me through',
  'walk through',
  'difference between',
  'give me an example',
]

/**
 * Interrogative followed by an auxiliary, anywhere in the sentence.
 *
 * Replaces an enumerated list of pairs ('how does', 'how do', 'how would'...),
 * which missed 'how did' - i.e. "And how did you test that", an obvious
 * question. Enumerating pairs is the wrong shape for this: the set is large and
 * every omission is a silently ignored question.
 *
 * This accepts some statements ("I know what is going on"). That asymmetry is
 * deliberate: an extra suggestion during a call costs one request, bounded by
 * the cooldown, whereas a missed question costs the user the moment the whole
 * app exists for.
 */
const INTERROGATIVE_AUX =
  /\b(what|why|how|when|where|which|who)\s+(is|are|was|were|do|does|did|would|could|can|should|will|have|has)\b/

/**
 * Cues that only count at the START.
 *
 * "can" or "do" mid-sentence is ordinary speech ("I can do that"); leading, it
 * is a question. Anchoring keeps these from matching half the transcript.
 */
const LEADING_CUES = [
  'what',
  'why',
  'how',
  'when',
  'where',
  'which',
  'who',
  'whose',
  'can you',
  'could you',
  'would you',
  'will you',
  'do you',
  'did you',
  'have you',
  'are you',
  'is there',
  'are there',
  'any thoughts',
  'any experience',
]

/** Does this read as something addressed to the user that wants an answer? */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  if (t.endsWith('?')) return true
  if (LEADING_CUES.some((cue) => t.startsWith(cue))) return true
  if (INTERROGATIVE_AUX.test(t)) return true
  return ANYWHERE_CUES.some((cue) => t.includes(cue))
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function shouldAutoAnswer(input: AutoAnswerInput): AutoAnswerDecision {
  if (!input.enabled) return { fire: false, reason: 'disabled' }

  // Interims change as speech arrives. Answering one means answering half a
  // question, and the next interim would trigger again.
  if (!input.isFinal) return { fire: false, reason: 'not final' }

  // The single most important guard. The mic stream is the user; answering it
  // would fire continuously while they speak and answer their own words back
  // to them.
  if (input.speaker !== 'them') return { fire: false, reason: 'own speech' }

  // The in-flight request would be dropped by the main-process guard anyway, but
  // silently - and the cooldown would then be armed for an answer that never
  // happened.
  if (input.busy) return { fire: false, reason: 'busy' }

  if (wordCount(input.text) < AUTO_ANSWER_MIN_WORDS) {
    return { fire: false, reason: 'too short' }
  }

  if (input.lastFiredAt !== null && input.now - input.lastFiredAt < AUTO_ANSWER_COOLDOWN_MS) {
    return { fire: false, reason: 'cooldown' }
  }

  if (!looksLikeQuestion(input.text)) return { fire: false, reason: 'not a question' }

  return { fire: true, reason: 'question from them' }
}
