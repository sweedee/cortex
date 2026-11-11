/**
 * Tiny line-based syntax highlighter for the diff view. Not a parser — a
 * single regex pass per line that is good enough for TS/JS, Java, YAML and
 * JSON. Token kinds map to the Strato `Colors.Syntax` tokens in review.css.
 */

export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'literal' | 'function' | 'type' | 'meta' | 'key';

export interface Token {
  text: string;
  kind?: TokenKind;
}

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue default delete do else enum export extends ' +
    'final finally for from function get if implements import in instanceof interface let new of package private ' +
    'protected public readonly return satisfies set static super switch this throw throws try type typeof var void ' +
    'while yield int long double float boolean char byte short record sealed permits keyof infer declare namespace'
  ).split(' '),
);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

const CODE =
  /(\/\/.*$|\/\*.*?(?:\*\/|$)|^\s*\*(?:\s.*|\/)?$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_]*(?:\.\d+)?[a-zA-Z]?\b)|(@[A-Za-z_]\w*)|([A-Za-z_$][\w$]*)|(\s+|[^\w\s"'`@/$]+|.)/g;

function tokenizeCode(line: string): Token[] {
  const out: Token[] = [];
  const push = (text: string, kind?: TokenKind) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  CODE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE.exec(line))) {
    if (m[0] === '') break;
    if (m[1] !== undefined) push(m[1], 'comment');
    else if (m[2] !== undefined) push(m[2], 'string');
    else if (m[3] !== undefined) push(m[3], 'number');
    else if (m[4] !== undefined) push(m[4], 'meta');
    else if (m[5] !== undefined) {
      const word = m[5];
      if (KEYWORDS.has(word)) push(word, 'keyword');
      else if (LITERALS.has(word)) push(word, 'literal');
      else if (line[CODE.lastIndex] === '(') push(word, 'function');
      else if (/^[A-Z]/.test(word)) push(word, 'type');
      else push(word);
    } else push(m[0]);
  }
  return out;
}

function yamlValue(value: string): Token[] {
  const comment = /(^|\s)#.*$/.exec(value);
  const body = comment ? value.slice(0, comment.index + comment[1].length) : value;
  const out: Token[] = [];
  const trimmed = body.trim();
  if (trimmed) {
    const kind: TokenKind | undefined = /^-?\d[\d_.]*$/.test(trimmed)
      ? 'number'
      : /^(true|false|null|~)$/.test(trimmed)
        ? 'literal'
        : 'string';
    out.push({ text: body, kind });
  } else if (body) out.push({ text: body });
  if (comment) out.push({ text: value.slice(body.length), kind: 'comment' });
  return out;
}

function tokenizeYaml(line: string): Token[] {
  if (/^\s*#/.test(line)) return [{ text: line, kind: 'comment' }];
  const m = /^(\s*(?:-\s+)?)([\w./-]+)(:)(.*)$/.exec(line);
  if (m) return [{ text: m[1] }, { text: m[2], kind: 'key' }, { text: m[3] }, ...yamlValue(m[4])];
  const item = /^(\s*-\s+)(.*)$/.exec(line);
  if (item) return [{ text: item[1] }, ...yamlValue(item[2])];
  return [{ text: line }];
}

const CODE_LANGUAGES = new Set(['ts', 'tsx', 'js', 'jsx', 'java', 'json', 'kt', 'go']);
const cache = new Map<string, Token[]>();

export function highlight(line: string, language: string): Token[] {
  const cacheKey = `${language}\u0000${line}`;
  let tokens = cache.get(cacheKey);
  if (!tokens) {
    tokens = CODE_LANGUAGES.has(language)
      ? tokenizeCode(line)
      : language === 'yaml'
        ? tokenizeYaml(line)
        : [{ text: line }];
    cache.set(cacheKey, tokens);
  }
  return tokens;
}
