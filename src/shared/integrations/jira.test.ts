import { describe, expect, it } from 'vitest';
import { adfToMarkdown, textToAdf } from './jira';

describe('ADF helpers', () => {
  it('round-trips plain text with paragraphs and bullet lists', () => {
    const text = 'First line\nsecond line\n\n- one\n- two';
    const adf = textToAdf(text);
    expect(adf.content?.map((n) => n.type)).toEqual(['paragraph', 'bulletList']);
    expect(adfToMarkdown(adf)).toBe(text);
  });

  it('renders marks, headings and code', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://x' } }] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'let a = 1' }] },
      ],
    };
    expect(adfToMarkdown(adf)).toBe('## Title\n\n**bold** and [link](https://x)\n\n```ts\nlet a = 1\n```');
    expect(adfToMarkdown('plain')).toBe('plain');
    expect(adfToMarkdown(null)).toBe('');
  });
});
