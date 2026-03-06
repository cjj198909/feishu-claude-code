import { describe, it, expect } from 'vitest';
import { parse } from '../command.js';

describe('parse', () => {
  it('should parse /add command', () => {
    const result = parse('/add frontend /home/user/frontend');
    expect(result).toEqual({ type: 'command', name: 'add', args: ['frontend', '/home/user/frontend'] });
  });

  it('should parse /use command', () => {
    const result = parse('/use backend');
    expect(result).toEqual({ type: 'command', name: 'use', args: ['backend'] });
  });

  it('should parse /list with no args', () => {
    const result = parse('/list');
    expect(result).toEqual({ type: 'command', name: 'list', args: [] });
  });

  it('should parse /config with key value', () => {
    const result = parse('/config permission_mode acceptEdits');
    expect(result).toEqual({ type: 'command', name: 'config', args: ['permission_mode', 'acceptEdits'] });
  });

  it('should parse /resume with id', () => {
    const result = parse('/resume 3');
    expect(result).toEqual({ type: 'command', name: 'resume', args: ['3'] });
  });

  it('should treat non-slash messages as prompts', () => {
    const result = parse('help me fix the bug');
    expect(result).toEqual({ type: 'prompt', text: 'help me fix the bug' });
  });

  it('should treat empty messages as prompts', () => {
    const result = parse('');
    expect(result).toEqual({ type: 'prompt', text: '' });
  });

  it('should handle /cost and /help and /stop and /reset and /status and /history', () => {
    for (const cmd of ['cost', 'help', 'stop', 'reset', 'status', 'history']) {
      const result = parse(`/${cmd}`);
      expect(result).toEqual({ type: 'command', name: cmd, args: [] });
    }
  });
});
