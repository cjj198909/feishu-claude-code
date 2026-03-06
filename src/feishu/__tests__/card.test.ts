import { describe, it, expect } from 'vitest';
import { buildRunningCard, buildDoneCard, buildErrorCard } from '../card.js';

describe('card templates', () => {
  it('should build running card', () => {
    const card = buildRunningCard('frontend', ['Read src/App.tsx', 'Edit src/App.tsx'], 'Analyzing...', 15);
    expect(card.header.template).toBe('blue');
    expect(card.header.title.content).toContain('frontend');
    const md = card.elements.find((e) => e.tag === 'markdown') as { tag: string; content: string };
    expect(md.content).toContain('Read src/App.tsx');
    expect(md.content).toContain('Analyzing...');
  });

  it('should build done card', () => {
    const card = buildDoneCard('frontend', 'Here is the result', { tools: 'Read×2, Edit×1', elapsed: 23, cost: 0.04, turns: 5 });
    expect(card.header.template).toBe('green');
    const md = card.elements.find((e) => e.tag === 'markdown') as { tag: string; content: string };
    expect(md.content).toContain('Here is the result');
  });

  it('should truncate long output in done card', () => {
    const longText = 'x'.repeat(5000);
    const card = buildDoneCard('frontend', longText, { tools: '', elapsed: 1, cost: 0, turns: 1 });
    const md = card.elements.find((e) => e.tag === 'markdown') as { tag: string; content: string };
    expect(md.content.length).toBeLessThan(4200);
    expect(md.content).toContain('输出已截断');
  });

  it('should build error card', () => {
    const card = buildErrorCard('frontend', 'Something went wrong', 3);
    expect(card.header.template).toBe('red');
    const md = card.elements.find((e) => e.tag === 'markdown') as { tag: string; content: string };
    expect(md.content).toContain('Something went wrong');
  });
});
