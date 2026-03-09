# Multimodal Image Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pass images directly to Claude Code via base64 content blocks instead of temp files + Read tool workaround.

**Architecture:** Add `attachments: Buffer[]` to `BridgeOptions`. When attachments exist, `bridge.execute()` constructs an `SDKUserMessage` with image content blocks and passes it via `AsyncIterable<SDKUserMessage>` to the SDK's `query()`. When no attachments, the existing string path is unchanged. Router collects image `Buffer[]` from Feishu and passes them through instead of writing temp files.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk` (query AsyncIterable path), Node.js Buffer, magic-byte MIME detection.

---

### Task 1: Add MIME detection helper and Attachment type to bridge.ts

**Files:**
- Modify: `src/claude/bridge.ts` (top of file, after imports)

**Step 1: Add the Attachment interface and detectMime helper**

After the existing imports, add:

```typescript
/** Image attachment for multimodal prompts */
export interface Attachment {
  buffer: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

/** Detect image MIME type from magic bytes, default to image/png */
function detectImageMime(buf: Buffer): Attachment['mediaType'] {
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return 'image/png';
}
```

**Step 2: Add `attachments` field to `BridgeOptions`**

```typescript
export interface BridgeOptions {
  cwd: string;
  resume?: string;
  allowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  enableQuestions?: boolean;
  attachments?: Buffer[];  // <-- add this line
}
```

**Step 3: Build and verify no type errors**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/claude/bridge.ts
git commit -m "feat: add Attachment type and MIME detection helper"
```

---

### Task 2: Modify bridge.execute() to support multimodal prompt via AsyncIterable

**Files:**
- Modify: `src/claude/bridge.ts` (the `execute` method and `query()` call)

**Step 1: Build content blocks and choose query path**

Replace the current `query()` call block (line ~231):

```typescript
// Current:
for await (const message of query({ prompt, options: queryOptions })) {

// New: build multimodal prompt when attachments are present
const attachments = options.attachments ?? [];
let queryPrompt: string | AsyncIterable<any>;

if (attachments.length > 0) {
  // Build content blocks: text + images
  const contentBlocks: Array<Record<string, unknown>> = [
    { type: 'text', text: prompt },
  ];
  for (const buf of attachments) {
    const mime = detectImageMime(buf);
    contentBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: mime, data: buf.toString('base64') },
    });
  }

  // Wrap as SDKUserMessage in a single-yield async generator
  const userMessage = {
    type: 'user' as const,
    session_id: '',
    message: { role: 'user' as const, content: contentBlocks },
    parent_tool_use_id: null,
  };
  queryPrompt = (async function* () { yield userMessage; })();

  logger.info('Using multimodal prompt', {
    textLength: prompt.length,
    imageCount: attachments.length,
    totalBase64Bytes: attachments.reduce((sum, b) => sum + b.length, 0),
  });
} else {
  queryPrompt = prompt;
}

for await (const message of query({ prompt: queryPrompt, options: queryOptions })) {
```

Everything after the `for await` stays identical.

**Step 2: Build and verify no type errors**

Run: `npx tsc --noEmit`
Expected: no errors (the `queryPrompt` type satisfies `string | AsyncIterable<SDKUserMessage>`)

**Step 3: Commit**

```bash
git add src/claude/bridge.ts
git commit -m "feat: send images as base64 content blocks via AsyncIterable"
```

---

### Task 3: Update router.ts image handling to pass Buffer[] instead of temp file paths

**Files:**
- Modify: `src/core/router.ts` (handle method, handlePostMessage, handlePrompt signature)

**Step 1: Change `handlePrompt` to accept optional attachments**

```typescript
// Change signature from:
private async handlePrompt(chatId: string, text: string): Promise<void> {

// To:
private async handlePrompt(chatId: string, text: string, attachments?: Buffer[]): Promise<void> {
```

And pass attachments to `bridge.execute()`:

```typescript
// In the bridge.execute() call, add attachments to options:
await this.bridge.execute(
  text,
  {
    cwd: project.path,
    resume: resumeSessionId ?? undefined,
    allowedTools: project.allowed_tools ? project.allowed_tools.split(',') : undefined,
    permissionMode: project.permission_mode,
    maxTurns: project.max_turns,
    enableQuestions: useCardkit,
    attachments,  // <-- add this line
  },
  (event: StreamEvent) => {
```

**Step 2: Update pure image message handler**

```typescript
// Replace the current image handler (lines 57-65):
} else if (msgType === 'image') {
  if (!imageKey) {
    await this.bot.sendText(chatId, 'Failed to get image key from message.');
    return;
  }
  const buffer = await this.bot.downloadImage(messageId, imageKey);
  await this.handlePrompt(chatId, 'Please look at this image.', [buffer]);
```

**Step 3: Update handlePostMessage to collect Buffer[] instead of file paths**

```typescript
private async handlePostMessage(chatId: string, messageId: string, content: string): Promise<void> {
  try {
    const parsed = JSON.parse(content);
    const postBody = parsed.zh_cn || parsed.en_us || parsed.ja_jp || parsed;
    const lines: Array<Array<{ tag: string; text?: string; image_key?: string }>> = postBody.content || [];

    const textParts: string[] = [];
    const imageBuffers: Buffer[] = [];

    for (const line of lines) {
      for (const element of line) {
        if (element.tag === 'text' && element.text) {
          textParts.push(element.text);
        } else if (element.tag === 'img' && element.image_key) {
          try {
            const buffer = await this.bot.downloadImage(messageId, element.image_key);
            imageBuffers.push(buffer);
          } catch (e) {
            logger.error('Failed to download image from post:', e);
          }
        }
      }
    }

    let prompt = textParts.join('').replace(/@_user_\d+/g, '').trim();
    if (!prompt && imageBuffers.length === 0) return;
    if (!prompt && imageBuffers.length > 0) {
      prompt = 'Please look at these images.';
    }

    // Check if it's a command (only for text-only messages)
    if (imageBuffers.length === 0) {
      const result = parse(prompt);
      if (result.type === 'command') {
        await this.handleCommand(chatId, result.name, result.args);
        return;
      }
      await this.handlePrompt(chatId, result.text);
    } else {
      await this.handlePrompt(chatId, prompt, imageBuffers);
    }
  } catch (err) {
    logger.error('Failed to parse post message:', err);
    await this.bot.sendText(chatId, 'Failed to parse rich text message.');
  }
}
```

**Step 4: Remove the `saveImage` import**

```typescript
// Delete this line from the imports:
import { saveImage } from '../feishu/image.js';
```

**Step 5: Build and verify no type errors**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 6: Commit**

```bash
git add src/core/router.ts
git commit -m "feat: pass image buffers directly to bridge instead of temp files"
```

---

### Task 4: Delete image.ts temp file helper

**Files:**
- Delete: `src/feishu/image.ts`

**Step 1: Verify no other files import image.ts**

Run: `grep -r "feishu/image" src/`
Expected: no matches (router.ts import was removed in Task 3)

**Step 2: Delete the file**

```bash
rm src/feishu/image.ts
```

**Step 3: Build and verify**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove temp file image helper (replaced by base64 content blocks)"
```

---

### Task 5: End-to-end test

**Step 1: Build**

Run: `npm run build`
Expected: success

**Step 2: Restart PM2**

Run: `pm2 restart feishu-claude-bridge`
Expected: process online

**Step 3: Test pure image message**

Send a screenshot to the bot in Feishu. Verify:
- Bot responds with analysis of the image
- No temp file written to `/tmp/feishu-images/`
- PM2 logs show "Using multimodal prompt" with imageCount: 1

**Step 4: Test rich text (post) with embedded image**

Send a Feishu rich text message containing both text and an image. Verify:
- Bot receives both text and image
- Response references both text content and image content
- PM2 logs show "Using multimodal prompt"

**Step 5: Test text-only (regression)**

Send a plain text message. Verify:
- Works exactly as before
- No "Using multimodal prompt" log line (string path used)

**Step 6: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues found in multimodal e2e test"
```
