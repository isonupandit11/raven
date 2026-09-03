/**
 * Whether an action has the context its prompt depends on.
 *
 * The bug this exists to stop: pressing "What should I say?" with an empty
 * transcript produced a fully-formed answer to a question nobody had asked -
 *
 *   <transcript> Them: "It sounds like you have a strong background in project
 *   management. Can you tell me about a time you had to manage a project where
 *   the requirements were constantly changing?" </transcript>
 *   "In a previous role, our client's scope expanded significantly..."
 *
 * ...on a machine where transcription was not running at all. buildTranscriptBlock
 * returns '' for an empty transcript, so no <transcript> section was sent, and
 * ACTION_PROMPTS['what-should-i-say'] still said "Suggest what the user should
 * say next in this conversation, based on <transcript>". Given an instruction
 * referring to a section that is not there, the model supplied the section.
 *
 * That is the worst possible failure for a live-assist tool: mid-call it answers
 * a question that was never asked, in the user's voice, and nothing in the UI
 * distinguishes it from a real answer. A visible "there is no transcript yet" is
 * strictly better than a plausible invention.
 *
 * The fix belongs here rather than in the prompt. Telling the model "say you
 * don't know if the transcript is empty" is a request; not calling it is a
 * guarantee.
 */

/**
 * Actions whose prompt is written entirely around <transcript>. With no
 * transcript there is nothing for them to be about, so they cannot degrade
 * gracefully - they can only invent.
 */
const TRANSCRIPT_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  'what-should-i-say',
  'follow-up',
  'recap',
  'tell-me-more',
])

export interface ActionContextParams {
  action: string
  transcript: string
  customPrompt?: string
  /** True when a screenshot is attached, which gives <screen> to work from. */
  hasScreenshot?: boolean
}

/**
 * Returns a user-facing reason the action cannot run, or null when it can.
 *
 * 'assist' is deliberately more permissive: its prompt explicitly handles the
 * "no transcript but there is a screen" case ("If <screen> shows a solvable
 * problem..."), so a screenshot alone is enough context. 'custom' is never
 * blocked - the user typed the question, so the content came from a human and
 * there is nothing to fabricate.
 */
export function blockedActionReason(params: ActionContextParams): string | null {
  const hasTranscript = params.transcript.trim().length > 0

  if (TRANSCRIPT_ONLY_ACTIONS.has(params.action)) {
    if (hasTranscript) return null
    return (
      'Nothing has been transcribed yet, so there is no conversation to work from. '
      + 'Start recording, or type your question in the box below.'
    )
  }

  if (params.action === 'assist') {
    if (hasTranscript || params.hasScreenshot) return null
    return (
      'No transcript and no screenshot, so there is nothing to assist with yet. '
      + 'Start recording, attach your screen, or type a question.'
    )
  }

  return null
}
