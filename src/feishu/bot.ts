import * as lark from '@larksuiteoapi/node-sdk';
import { logger } from '../utils/logger.js';

/** Extract Feishu API error details (field_violations etc.) for logging */
function feishuErrorDetail(err: unknown): string {
  try {
    const e = err as any;
    // SDK error has response.data or a top-level data
    const data = e?.response?.data ?? e?.data ?? e;
    return JSON.stringify(data, null, 2);
  } catch {
    return String(err);
  }
}

export type MessageHandler = (event: {
  messageId: string;
  chatId: string;
  senderId: string;
  msgType: string;
  content: string;
  imageKey?: string;
}) => Promise<void>;

export interface CardActionEvent {
  operator?: { open_id?: string };
  action?: {
    tag?: string;
    value?: Record<string, unknown>;
    form_value?: Record<string, string>;
  };
  context?: {
    open_chat_id?: string;
    open_message_id?: string;
  };
}

export type CardActionHandler = (event: CardActionEvent) => Promise<void>;

export class FeishuBot {
  private client: lark.Client;
  private wsClient?: lark.WSClient;
  private onMessage?: MessageHandler;
  private onCardAction?: CardActionHandler;
  private appId: string;
  private appSecret: string;
  private processedMessages = new Set<string>();

  // Cardkit streaming state: messageId -> { cardId, sequence, closed }
  private cardkitState = new Map<string, { cardId: string; seq: number; closed?: boolean }>();

  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.client = new lark.Client({ appId, appSecret });
  }

  setMessageHandler(handler: MessageHandler) {
    this.onMessage = handler;
  }

  setCardActionHandler(handler: CardActionHandler) {
    this.onCardAction = handler;
  }

  async start() {
    const cardActionHandler = async (data: unknown) => {
      try {
        const evt = data as CardActionEvent;
        const value = evt.action?.value;
        if (value?.['_fcc_action'] !== 'questions_submit') return;

        // Fire-and-forget: handler processes answers asynchronously
        if (this.onCardAction) {
          this.onCardAction(evt).catch(err =>
            logger.error('Card action handler error:', err)
          );
        }

        // Return toast immediately (within 3 second limit)
        return { toast: { type: 'success', content: '已提交' } };
      } catch (err) {
        logger.error('Error handling card action:', err);
      }
    };

    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        try {
          const msg = data.message;
          const sender = data.sender;

          // Deduplicate: Feishu retries if processing takes too long
          if (this.processedMessages.has(msg.message_id)) {
            logger.debug(`Duplicate message ignored: ${msg.message_id}`);
            return;
          }
          this.processedMessages.add(msg.message_id);
          // Prevent memory leak: cap at 1000 entries
          if (this.processedMessages.size > 1000) {
            const first = this.processedMessages.values().next().value!;
            this.processedMessages.delete(first);
          }

          const event: Parameters<MessageHandler>[0] = {
            messageId: msg.message_id,
            chatId: msg.chat_id,
            senderId: sender.sender_id?.open_id ?? 'unknown',
            msgType: msg.message_type,
            content: msg.content,
            imageKey: undefined,
          };

          if (msg.message_type === 'image') {
            try {
              const parsed = JSON.parse(msg.content);
              event.imageKey = parsed.image_key;
            } catch {
              // ignore parse errors
            }
          }

          if (this.onMessage) {
            await this.onMessage(event);
          }
        } catch (err) {
          logger.error('Error handling Feishu message:', err);
        }
      },

      // Handle interactive card form submissions (AskUserQuestion answers).
      // Must return a response within 3 seconds — process asynchronously.
      'card.action.trigger': cardActionHandler,
    } as any);

    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: lark.LoggerLevel.debug,
    });

    await this.wsClient.start({ eventDispatcher: dispatcher });

    logger.info('Feishu WSClient connected');
  }

  async sendText(chatId: string, text: string): Promise<string> {
    const resp = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
    return resp.data?.message_id ?? '';
  }

  async sendCard(chatId: string, card: object): Promise<string> {
    const resp = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
    return resp.data?.message_id ?? '';
  }

  async updateCard(messageId: string, card: object): Promise<void> {
    await this.client.im.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(card),
      },
    });
  }

  // ─── Cardkit Streaming API (JSON 2.0) ──────────────────────────

  /**
   * Create a streaming card via cardkit API and send it as a message.
   * Returns messageId for tracking. Use updateCardElement() for updates.
   */
  async sendStreamingCard(chatId: string, card: Record<string, unknown>): Promise<string> {
    // Step 1: Create card entity via cardkit
    const cardResp = await (this.client as any).cardkit.v1.card.create({
      data: { type: 'card_json', data: JSON.stringify(card) },
    });

    if (cardResp.code !== 0) {
      throw new Error(`cardkit.card.create failed (code ${cardResp.code}): ${cardResp.msg ?? ''}`);
    }

    const cardId = cardResp.data?.card_id;
    if (!cardId) {
      throw new Error('cardkit.card.create returned no card_id');
    }

    // Step 2: Send message with card_id reference
    const msgResp = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
      },
    });

    const messageId = msgResp.data?.message_id ?? '';
    if (messageId) {
      this.cardkitState.set(messageId, { cardId, seq: 1 });
    }

    return messageId;
  }

  private nextSeq(messageId: string): number {
    const state = this.cardkitState.get(messageId);
    if (!state) return 1;
    state.seq += 1;
    return state.seq;
  }

  /**
   * Update a markdown element's content within a streaming card.
   * Pass the FULL accumulated text — Feishu computes the delta for typewriter effect.
   */
  async updateCardElement(messageId: string, elementId: string, content: string): Promise<void> {
    if (!content) return; // Skip empty content updates (Feishu rejects them)

    const state = this.cardkitState.get(messageId);
    if (!state || state.closed) {
      // State missing or card already finalized — skip to avoid 99992402 errors
      return;
    }

    try {
      const seq = this.nextSeq(messageId);
      await (this.client as any).cardkit.v1.cardElement.content({
        path: { card_id: state.cardId, element_id: elementId },
        data: { content, sequence: seq },
      });
    } catch (err) {
      logger.error('Failed to update card element:', {
        elementId,
        contentLength: content.length,
        contentPreview: content.slice(0, 100),
        seq: state.seq,
        detail: feishuErrorDetail(err),
      });
    }
  }

  /**
   * Full card update via cardkit (PUT). Used to update header + body on completion.
   * Accepts a complete Card JSON 2.0 object.
   */
  async updateStreamingCard(messageId: string, card: Record<string, unknown>): Promise<void> {
    const state = this.cardkitState.get(messageId);
    if (!state) return;

    // Mark as closed immediately so in-flight element updates are skipped
    state.closed = true;

    try {
      const seq = this.nextSeq(messageId);
      const cardJson = JSON.stringify(card);
      logger.info('Updating streaming card', { cardId: state.cardId, seq, cardJsonLength: cardJson.length });
      await (this.client as any).cardkit.v1.card.update({
        path: { card_id: state.cardId },
        data: {
          card: { type: 'card_json', data: cardJson },
          sequence: seq,
        },
      });
      logger.info('Streaming card updated successfully');
    } catch (err) {
      logger.error('Failed to update streaming card:', feishuErrorDetail(err));
    } finally {
      // Always clean up cardkit state — whether update succeeded or failed.
      // Leaving orphaned state causes next task to reuse stale cardId/seq,
      // resulting in stuck "executing" cards.
      this.cardkitState.delete(messageId);
    }
  }

  /**
   * Replace card content and re-enable streaming mode.
   * Used after the user submits a question form to show "processing" state
   * and allow subsequent element updates (typewriter).
   *
   * Unlike updateStreamingCard(), this does NOT delete cardkitState —
   * the card remains "alive" for further element updates.
   */
  async reopenCardStreaming(messageId: string, card: Record<string, unknown>): Promise<void> {
    const state = this.cardkitState.get(messageId);
    if (!state) {
      logger.warn(`No cardkit state for ${messageId}, cannot reopen streaming`);
      return;
    }

    try {
      const seq = this.nextSeq(messageId);
      await (this.client as any).cardkit.v1.card.update({
        path: { card_id: state.cardId },
        data: {
          card: { type: 'card_json', data: JSON.stringify(card) },
          sequence: seq,
        },
      });
      // Streaming re-enabled — cardElement.content API will work again
      logger.info('Card streaming reopened', { messageId, cardId: state.cardId });
    } catch (err) {
      logger.error('Failed to reopen card streaming:', feishuErrorDetail(err));
    }
  }

  /**
   * Close streaming mode on a card (enables form interactions).
   * Does NOT delete cardkit state — further element updates are still possible.
   */
  async closeCardStreaming(messageId: string): Promise<void> {
    const state = this.cardkitState.get(messageId);
    if (!state) return;

    try {
      const seq = this.nextSeq(messageId);
      await (this.client as any).cardkit.v1.card.settings({
        path: { card_id: state.cardId },
        data: {
          settings: JSON.stringify({ config: { streaming_mode: false } }),
          sequence: seq,
        },
      });
      // NOTE: state preserved so appendCardElements / updateCardElement can still be used
    } catch (err) {
      logger.error('Failed to close card streaming:', feishuErrorDetail(err));
    }
  }

  /**
   * Append elements to an existing cardkit card.
   * Used to add question forms after closing streaming mode.
   */
  async appendCardElements(messageId: string, elements: Record<string, unknown>[]): Promise<void> {
    const state = this.cardkitState.get(messageId);
    if (!state) {
      logger.warn(`No cardkit state for message ${messageId}, skipping appendCardElements`);
      return;
    }

    try {
      const seq = this.nextSeq(messageId);
      await (this.client as any).cardkit.v1.cardElement.create({
        path: { card_id: state.cardId },
        data: {
          type: 'append',
          elements: JSON.stringify(elements),
          sequence: seq,
        },
      });
    } catch (err) {
      logger.error('Failed to append card elements:', feishuErrorDetail(err));
    }
  }

  /**
   * Check if a message has an active cardkit streaming state.
   */
  hasCardkitState(messageId: string): boolean {
    return this.cardkitState.has(messageId);
  }

  /**
   * Get the card_id for a message (needed for form question routing).
   */
  getCardId(messageId: string): string | undefined {
    return this.cardkitState.get(messageId)?.cardId;
  }

  /**
   * Clean up cardkit state for a message (after all updates are done).
   */
  cleanupCardkitState(messageId: string): void {
    this.cardkitState.delete(messageId);
  }

  async downloadImage(messageId: string, imageKey: string): Promise<Buffer> {
    const resp = await this.client.im.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: 'image' },
    });
    if (Buffer.isBuffer(resp)) return resp;
    const readable = resp.getReadableStream();
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
