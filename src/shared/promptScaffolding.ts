/**
 * Strip our own prompt scaffolding out of a model response.
 *
 * The user message is assembled from XML-ish sections - <transcript>, <screen>,
 * <user_input>, <reference_documents> - and the system prompt names them so the
 * model knows they are data. Models sometimes echo those tags back. The
 * observed case was a response that began:
 *
 *   <transcript> </transcript>
 *   Not sure what you need help with right now.
 *
 * That happened on an assist with a screenshot and no transcript: the assist
 * prompt ends "Cite the transcript line that anchors your response", which is
 * impossible with no transcript, so the model emitted the empty section and
 * then admitted it had nothing. The answer underneath was honest - the leak is
 * that our internal wire format was showing through into the reading surface.
 *
 * Deliberately conservative. Only removes tags that are unambiguously
 * scaffolding echo: an empty pair, or a tag alone on its own line. A pair with
 * real content inside is left alone, because at that point the content is what
 * the user wants to read and guessing at its boundaries risks eating the answer
 * - and because a model writing about HTML could legitimately produce a line
 * like `<screen>` inside a code fence.
 */

/**
 * Section names used by buildUserMessage and buildSystemPrompt. Only these are
 * ever stripped, so ordinary markup in an answer survives.
 */
const SCAFFOLD_TAGS = [
  'transcript',
  'screen',
  'user_input',
  'reference_documents',
  'priority_system',
  'mode_personality',
  'mode_authority',
  'content_formats',
] as const

const TAG_NAMES = SCAFFOLD_TAGS.join('|')

/** <transcript>   </transcript>, including attributes on the opening tag. */
const EMPTY_PAIR = new RegExp(`<(${TAG_NAMES})(\\s[^>]*)?>\\s*</\\1\\s*>`, 'gi')

/**
 * A lone opening, closing or self-closing tag occupying its whole line.
 *
 * The line terminator is part of the match on purpose. Removing only the tag
 * text would leave the now-empty line behind, so the answer still began one
 * line down from where it should.
 */
const STANDALONE_LINE = new RegExp(
  `^[ \\t]*</?(?:${TAG_NAMES})(?:\\s[^>]*)?/?>[ \\t]*(?:\\r?\\n|$)`,
  'gim',
)

/**
 * A truncated tag at the very end of a streaming response, e.g. "<transcr".
 * Without this the tag renders character by character as it arrives and only
 * disappears once complete, which reads as a glitch.
 */
const TRAILING_PARTIAL = /<\/?[a-z_]*$/i

export function stripPromptScaffolding(
  text: string,
  options?: { streaming?: boolean },
): string {
  if (!text) return text

  let out = text.replace(EMPTY_PAIR, '').replace(STANDALONE_LINE, '')

  if (options?.streaming) {
    out = out.replace(TRAILING_PARTIAL, '')
  }

  // Removing a section leaves blank lines where it was; collapse them so the
  // answer does not start halfway down the bubble.
  out = out.replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '')

  // Trailing whitespace is trimmed only on final text. Mid-stream the last
  // character is often the space that will separate the current word from the
  // next chunk, so removing it makes words appear to collide and then part
  // again as the response arrives.
  return options?.streaming ? out : out.replace(/\s+$/, '')
}
