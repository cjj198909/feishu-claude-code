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

/**
 * Build a Card JSON 2.0 for the "processing answer" state.
 * Shown immediately after the user submits the question form —
 * removes the form, re-enables streaming so subsequent element updates work.
 */
export function buildProcessingStreamingCard(projectName: string): Record<string, unknown> {
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
      title: { tag: 'plain_text', content: `🔄 处理中 | 项目: ${projectName}` },
      template: 'blue',
    },
    body: {
      elements: [
        { tag: 'markdown', element_id: ELEMENT_IDS.mainContent, content: '⏳ 处理回答中...' },
        { tag: 'hr', element_id: ELEMENT_IDS.divider },
        { tag: 'markdown', element_id: ELEMENT_IDS.stats, content: '处理中...' },
      ],
    },
  };
}

// ─── Interactive question form (Card JSON 2.0) ───────────────

/**
 * Build card elements for an AskUserQuestion interactive form.
 * Returns an array to be appended to a streaming card via appendCardElements().
 *
 * Layout: hr → prompt → form(select_static per question + submit button)
 *
 * The submit button encodes the questionId and chatId in its callback value
 * so the card.action.trigger handler can route answers to the right QuestionManager entry.
 *
 * IMPORTANT: streaming_mode must be closed BEFORE appending these elements,
 * otherwise form interactions are disabled.
 */
export function buildQuestionFormElements(
  questions: Array<{ question: string; header?: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }>,
  questionId: string,
  chatId: string,
  projectName: string,
): Record<string, unknown>[] {
  const formInner: Record<string, unknown>[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const headerText = q.header ? ` *(${q.header})*` : '';
    formInner.push({ tag: 'markdown', content: `**${i + 1}. ${q.question}**${headerText}` });
    formInner.push({
      tag: 'select_static',
      name: `q${i}`,
      required: true,
      width: 'fill',
      placeholder: { tag: 'plain_text', content: '请选择...' },
      options: q.options.map(opt => ({
        text: {
          tag: 'plain_text',
          content: opt.description ? `${opt.label}: ${opt.description}` : opt.label,
        },
        value: opt.label,
      })),
    });
  }

  formInner.push({
    tag: 'button',
    name: 'fcc_submit',
    type: 'primary_filled',
    width: 'default',
    text: { tag: 'plain_text', content: '提交' },
    form_action_type: 'submit',
    behaviors: [
      {
        type: 'callback',
        value: {
          _fcc_action: 'questions_submit',
          _fcc_question_id: questionId,
          _fcc_chat_id: chatId,
          _fcc_project_name: projectName,
        },
      },
    ],
  });

  return [
    { tag: 'hr' },
    { tag: 'markdown', content: '**💡 请回答以下问题：**' },
    { tag: 'form', name: 'fcc_questions', vertical_spacing: '12px', elements: formInner },
  ];
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
