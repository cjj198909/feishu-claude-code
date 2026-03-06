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
