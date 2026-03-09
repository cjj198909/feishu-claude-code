// src/feishu/card.ts

const MAX_CONTENT_LENGTH = 4000;

// Element IDs for streaming card updates
export const ELEMENT_IDS = {
  mainContent: 'main_content',
  divider: 'divider',
  stats: 'stats',
} as const;

/**
 * Build a Card JSON 2.0 object for streaming via cardkit API.
 * Uses schema: '2.0' with body.elements (not top-level elements).
 */
export function buildStreamingCard(projectName: string): Record<string, unknown> {
  return {
    schema: '2.0',
    config: {
      streaming_mode: true,
      streaming_config: {
        print_frequency_ms: { default: 50 },
        print_step: { default: 5 },
        print_strategy: 'delay',
      },
    },
    header: {
      title: { tag: 'plain_text', content: `🔄 执行中 | 项目: ${projectName}` },
      template: 'blue',
    },
    body: {
      elements: [
        { tag: 'markdown', element_id: ELEMENT_IDS.mainContent, content: '处理中...' },
        { tag: 'hr', element_id: ELEMENT_IDS.divider },
        { tag: 'markdown', element_id: ELEMENT_IDS.stats, content: '⏱️ 0s | 🔧 0 tools' },
      ],
    },
  };
}

/**
 * Build a Card JSON 2.0 for the final "done" state.
 * Used with card.update (PUT) to replace header + body.
 */
export function buildDoneStreamingCard(
  projectName: string,
  resultText: string,
  stats: { tools: string; elapsed: number; cost: number; turns: number }
): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { streaming_mode: false },
    header: {
      title: { tag: 'plain_text', content: `✅ 完成 | 项目: ${projectName}` },
      template: 'green',
    },
    body: {
      elements: [
        { tag: 'markdown', element_id: ELEMENT_IDS.mainContent, content: truncate(resultText) },
        { tag: 'hr', element_id: ELEMENT_IDS.divider },
        { tag: 'markdown', element_id: ELEMENT_IDS.stats, content: `*🔧 ${stats.tools} | ⏱️ ${stats.elapsed}s | 💰 $${stats.cost.toFixed(4)} | 🔄 ${stats.turns} turns*` },
      ],
    },
  };
}

export function buildErrorStreamingCard(projectName: string, errorMessage: string, elapsedSec: number): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { streaming_mode: false },
    header: {
      title: { tag: 'plain_text', content: `❌ 错误 | 项目: ${projectName}` },
      template: 'red',
    },
    body: {
      elements: [
        { tag: 'markdown', element_id: ELEMENT_IDS.mainContent, content: truncate(errorMessage) },
        { tag: 'hr', element_id: ELEMENT_IDS.divider },
        { tag: 'markdown', element_id: ELEMENT_IDS.stats, content: `*⏱️ ${elapsedSec}s*` },
      ],
    },
  };
}

export function buildAbortedStreamingCard(projectName: string, lastText: string, elapsedSec: number): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { streaming_mode: false },
    header: {
      title: { tag: 'plain_text', content: `⏹️ 已中止 | 项目: ${projectName}` },
      template: 'orange',
    },
    body: {
      elements: [
        { tag: 'markdown', element_id: ELEMENT_IDS.mainContent, content: truncate(lastText || '任务已中止') },
        { tag: 'hr', element_id: ELEMENT_IDS.divider },
        { tag: 'markdown', element_id: ELEMENT_IDS.stats, content: `*⏱️ ${elapsedSec}s*` },
      ],
    },
  };
}

// ─── Legacy card format (for im.message.patch fallback) ──────

interface CardElement {
  tag: string;
  element_id?: string;
  [key: string]: unknown;
}

interface Card {
  config: { wide_screen_mode: boolean };
  header: {
    title: { tag: string; content: string };
    template: string;
  };
  elements: CardElement[];
}

export function buildRunningCard(projectName: string, toolCalls: string[], latestText: string, elapsedSec: number): Card {
  const body = latestText || '处理中...';

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `🔄 执行中 | 项目: ${projectName}` },
      template: 'blue',
    },
    elements: [
      { tag: 'markdown', content: truncate(body) },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `⏱️ ${elapsedSec}s | 🔧 ${toolCalls.length} tools` }] },
    ],
  };
}

export function buildDoneCard(projectName: string, resultText: string, stats: { tools: string; elapsed: number; cost: number; turns: number }): Card {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `✅ 完成 | 项目: ${projectName}` },
      template: 'green',
    },
    elements: [
      { tag: 'markdown', content: truncate(resultText) },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `🔧 ${stats.tools} | ⏱️ ${stats.elapsed}s | 💰 $${stats.cost.toFixed(4)} | 🔄 ${stats.turns} turns` }] },
    ],
  };
}

export function buildErrorCard(projectName: string, errorMessage: string, elapsedSec: number): Card {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `❌ 错误 | 项目: ${projectName}` },
      template: 'red',
    },
    elements: [
      { tag: 'markdown', content: truncate(errorMessage) },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `⏱️ ${elapsedSec}s` }] },
    ],
  };
}

export function buildAbortedCard(projectName: string, lastText: string, elapsedSec: number): Card {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `⏹️ 已中止 | 项目: ${projectName}` },
      template: 'orange',
    },
    elements: [
      { tag: 'markdown', content: truncate(lastText || '任务已中止') },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `⏱️ ${elapsedSec}s` }] },
    ],
  };
}

function truncate(text: string): string {
  if (text.length <= MAX_CONTENT_LENGTH) return text;
  return text.slice(0, MAX_CONTENT_LENGTH) + '\n\n---\n⚠️ 输出已截断';
}
