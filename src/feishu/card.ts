// src/feishu/card.ts

const MAX_CONTENT_LENGTH = 4000;

interface CardElement {
  tag: string;
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
