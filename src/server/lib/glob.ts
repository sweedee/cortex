/**
 * Minimal glob to RegExp for `fs:list`: `**` (any depth, incl. none), `*` (within one path
 * segment), `?` (one char), `{a,b}` alternatives. Matched against forward-slash paths.
 */
export function globToRegExp(glob: string, caseInsensitive = process.platform === 'win32'): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches zero or more directories, a trailing "**" anything
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') re += '(?:';
    else if (c === '}') re += ')';
    else if (c === ',') re += '|';
    else re += (c ?? '').replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, caseInsensitive ? 'i' : '');
}

/** does the glob need a recursive walk? */
export const isDeepGlob = (glob: string) => glob.includes('/') || glob.includes('**');
