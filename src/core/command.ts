export interface ParsedCommand {
  type: 'command';
  name: string;
  args: string[];
}

export interface ParsedPrompt {
  type: 'prompt';
  text: string;
}

export type ParseResult = ParsedCommand | ParsedPrompt;

export function parse(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { type: 'prompt', text: trimmed };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase() ?? '';
  const args = parts.slice(1);

  return { type: 'command', name, args };
}
