import type { ChatSource } from '@/types/ai';

/**
 * Strips an assistant answer's Markdown down to text suitable for speech synthesis: no heading/list/table markup,
 * no fenced-code delimiters, link URLs dropped (link text kept), and [S#] citation tags dropped silently rather than
 * read aloud as "bracket S one". Only strips - never rewrites or summarizes the wording.
 */
export function toSpeechText(markdown: string, _sources?: ChatSource[]): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/```[\w-]*\n([\s\S]*?)```/g, (_m, code: string) => ` ${code.replace(/\n/g, '. ')} `)
    .replace(/\[S\d+\]/g, '')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/g, '$1')
    .replace(/^(#{1,4})\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(?<![*\w])\*([^*\s][^*]*)\*(?![*\w])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
}
