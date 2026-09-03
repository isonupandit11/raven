import type { AIProvider, AIMessage, AIContentPart, StreamCallbacks } from './types';
import { buildOpenAIEffortParams, streamMaxTokensFor } from './types';
import type OpenAI from 'openai';

/**
 * Output cap for third-party OpenAI-compatible endpoints.
 *
 * streamMaxTokensFor() returns OpenAI's ceilings (up to 128k), which other
 * vendors reject outright - Gemini 2.5 Flash tops out far lower, so passing
 * the OpenAI number turns every request into a 400. A conservative cap is
 * both portable and ample: a spoken answer is a few hundred tokens.
 */
const CUSTOM_ENDPOINT_MAX_TOKENS = 8192;

/** Host only - a base URL can carry a key in a query string on some gateways. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'The configured endpoint';
  }
}

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai' as const;
  private apiKey: string;
  private model: string;
  private effort?: string;
  /**
   * Optional OpenAI-compatible endpoint. Empty = api.openai.com.
   *
   * This is how Gemini, Groq, OpenRouter, DeepSeek and a local Ollama are
   * reached without writing a provider per vendor: they all speak the
   * /chat/completions wire format. Gemini's is
   * https://generativelanguage.googleapis.com/v1beta/openai
   *
   * Any host used here must also be in the renderer CSP connect-src
   * (windowManager.applyCSP) or the request fails with no useful error.
   */
  private baseUrl?: string;

  constructor(apiKey: string, model: string, effort?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.effort = effort;
    this.baseUrl = baseUrl?.trim() || undefined;
  }

  /** Client options; baseURL is omitted entirely when unset so the SDK default applies. */
  private clientOptions(): { apiKey: string; baseURL?: string } {
    return this.baseUrl ? { apiKey: this.apiKey, baseURL: this.baseUrl } : { apiKey: this.apiKey };
  }

  async streamResponse(
    params: { system: string; messages: AIMessage[]; maxTokens?: number },
    callbacks: StreamCallbacks
  ): Promise<void> {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI(this.clientOptions());

    // Build as the SDK's discriminated ChatCompletionMessageParam union
    // rather than a widened { role: 'system' | 'user' | 'assistant' }
    // shape: the SDK narrows each variant's role to a single literal, and
    // ChatCompletionAssistantMessageParam's content cannot contain
    // image_url parts (assistants don't emit images). Assistant messages
    // from our AIMessage contract have always been strings at runtime
    // (model responses), so flatten any accidental image content to its
    // text parts for the assistant branch rather than blindly passing
    // what convertContent returns.
    const systemMessage: OpenAIChatMessage = { role: 'system', content: params.system };
    const userMessages: OpenAIChatMessage[] = params.messages.map((msg) => {
      if (msg.role === 'user') {
        return { role: 'user', content: this.convertContent(msg.content) };
      }
      const assistantText = typeof msg.content === 'string'
        ? msg.content
        : msg.content
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            // Use a newline, not an empty string. Multipart assistant
            // content only occurs in OSS builds where users bring their
            // own OpenAI key; joining with '' would silently mash
            // sentences together ("Hello.How are you?") and degrade
            // follow-up LLM context. Newline matches how the Anthropic
            // provider flattens the same case.
            .join('\n');
      return { role: 'assistant', content: assistantText };
    });
    const openaiMessages: OpenAIChatMessage[] = [systemMessage, ...userMessages];

    let fullText = '';

    try {
      const stream = await client.chat.completions.create({
        model: this.model,
        ...this.maxTokensParam(params.maxTokens ?? this.defaultMaxTokens()),
        messages: openaiMessages,
        stream: true,
        ...this.effortParams(),
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) {
          fullText += text;
          callbacks.onText(text);
        }
      }

      callbacks.onDone(fullText);
    } catch (error: unknown) {
      let errorMsg = 'Failed to get AI response.';
      const status = error != null && typeof error === 'object' && 'status' in error
        ? (error as { status: number }).status
        : undefined;
      if (status === 401) {
        errorMsg = this.baseUrl
          ? 'Endpoint rejected the API key. Check the key and base URL in settings.'
          : 'Invalid OpenAI API key. Check settings.';
      }
      else if (status === 429) errorMsg = 'Rate limited. Wait a moment and try again.';
      else if (status === 404) {
        // The OpenAI wire format puts the model in the BODY, not the path, so a
        // 404 here almost always means the endpoint does not recognise the
        // model - not that the URL is wrong. The SDK surfaces it as "404 status
        // code (no body)", which tells the user nothing and is what they were
        // actually staring at while a stale OpenAI model id was being sent to
        // Gemini.
        errorMsg = this.baseUrl
          ? `${hostOf(this.baseUrl)} does not recognise the model "${this.model}". `
            + 'Pick one from Settings, Model, Fetch list.'
          : `OpenAI does not recognise the model "${this.model}". Choose a different model in Settings.`;
      }
      else if (error instanceof Error) errorMsg = `AI error: ${error.message}`;
      callbacks.onError(errorMsg);
      throw error;
    }
  }

  async generateShort(params: {
    system?: string;
    prompt: string;
    maxTokens?: number;
  }): Promise<string> {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI(this.clientOptions());

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (params.system) {
      messages.push({ role: 'system', content: params.system });
    }
    messages.push({ role: 'user', content: params.prompt });

    const response = await client.chat.completions.create({
      model: this.model,
      ...this.maxTokensParam(this.defaultMaxTokens()),
      messages,
      ...this.effortParams(),
    });

    return response.choices[0]?.message?.content?.trim() || '';
  }

  private defaultMaxTokens(): number {
    return this.baseUrl ? CUSTOM_ENDPOINT_MAX_TOKENS : streamMaxTokensFor('openai', this.model);
  }

  /**
   * The token-limit parameter this endpoint accepts.
   *
   * Every model in our OpenAI catalog (GPT-5.2 through 5.6) is a reasoning
   * model, and those reject `max_tokens` outright: "Unsupported parameter:
   * 'max_tokens' is not supported with this model. Use
   * 'max_completion_tokens' instead." So first-party OpenAI must send
   * max_completion_tokens.
   *
   * Adapted from markrod828's fork of upstream, which makes the swap
   * UNCONDITIONAL on the grounds that "resolveCatalogModel() clamps this.model
   * to the catalog, so a legacy Chat-Completions-only model can never reach
   * us". That premise is false here: providerFactory deliberately BYPASSES
   * resolveCatalogModel when baseUrl is set, precisely so a third-party id like
   * gemini-2.5-flash passes through untouched. Taking their change as-is would
   * have sent max_completion_tokens to Gemini, Groq and Ollama, whose
   * compatibility layers document max_tokens.
   *
   * So it is keyed on the endpoint, the same axis everything else here uses:
   * first-party OpenAI gets the reasoning-model parameter, a custom endpoint
   * keeps the classic one.
   */
  private maxTokensParam(value: number): Record<string, number> {
    return this.baseUrl ? { max_tokens: value } : { max_completion_tokens: value };
  }

  private effortParams(): Record<string, unknown> {
    // Reasoning-effort is an OpenAI-specific parameter. Gemini's OpenAI shim,
    // Groq and most other compatible endpoints reject unknown fields with a
    // 400 rather than ignoring them, and our MODEL_CATALOG ladders describe
    // OpenAI models only - so a third-party model id would be looked up
    // against the wrong table anyway. Send nothing on a custom endpoint.
    if (this.baseUrl) return {};
    return buildOpenAIEffortParams(this.model, this.effort);
  }

  private convertContent(
    content: string | AIContentPart[]
  ): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
    if (typeof content === 'string') return content;

    return content.map((part) => {
      if (part.type === 'text') {
        return { type: 'text' as const, text: part.text };
      }
      return {
        type: 'image_url' as const,
        image_url: {
          url: `data:${part.mediaType};base64,${part.base64}`,
        },
      };
    });
  }
}

type OpenAIChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
