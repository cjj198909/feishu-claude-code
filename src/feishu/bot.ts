import * as lark from '@larksuiteoapi/node-sdk';
import { logger } from '../utils/logger.js';

export type MessageHandler = (event: {
  messageId: string;
  chatId: string;
  senderId: string;
  msgType: string;
  content: string;
  imageKey?: string;
}) => Promise<void>;

export class FeishuBot {
  private client: lark.Client;
  private wsClient?: lark.WSClient;
  private onMessage?: MessageHandler;
  private appId: string;
  private appSecret: string;
  private processedMessages = new Set<string>();

  // Cardkit streaming state: messageId -> { cardId, sequence }
  private cardkitState = new Map<string, { cardId: string; seq: number }>();

  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.client = new lark.Client({ appId, appSecret });
  }

  setMessageHandler(handler: MessageHandler) {
    this.onMessage = handler;
  }

  async start() {
    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
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
    });

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
    const state = this.cardkitState.get(messageId);
    if (!state) {
      logger.warn(`No cardkit state for message ${messageId}, skipping element update`);
      return;
    }

    try {
      const seq = this.nextSeq(messageId);
      await (this.client as any).cardkit.v1.cardElement.content({
        path: { card_id: state.cardId, element_id: elementId },
        data: { content, sequence: seq },
      });
    } catch (err) {
      logger.error('Failed to update card element:', err);
    }
  }

  /**
   * Full card update via cardkit (PUT). Used to update header + body on completion.
   * Accepts a complete Card JSON 2.0 object.
   */
  async updateStreamingCard(messageId: string, card: Record<string, unknown>): Promise<void> {
    const state = this.cardkitState.get(messageId);
    if (!state) return;

    try {
      const seq = this.nextSeq(messageId);
      await (this.client as any).cardkit.v1.card.update({
        path: { card_id: state.cardId },
        data: {
          card: { type: 'card_json', data: JSON.stringify(card) },
          sequence: seq,
        },
      });
      // Clean up after full update (streaming is closed)
      this.cardkitState.delete(messageId);
    } catch (err) {
      logger.error('Failed to update streaming card:', err);
    }
  }

  /**
   * Close streaming mode on a card (makes it final / no more typewriter).
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

      // Clean up
      this.cardkitState.delete(messageId);
    } catch (err) {
      logger.error('Failed to close card streaming:', err);
    }
  }

  /**
   * Check if a message has an active cardkit streaming state.
   */
  hasCardkitState(messageId: string): boolean {
    return this.cardkitState.has(messageId);
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
