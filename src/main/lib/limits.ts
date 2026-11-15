/** Run-time limits from config.json `limits.*`, set by main at start and on every config change. */
import { DEFAULT_USER_CONFIG, type UserConfig } from '../../shared/userConfig';

let current = DEFAULT_USER_CONFIG.limits;

export const setLimits = (l: UserConfig['limits']) => {
  current = l;
};
export const execTimeoutMs = () => current.execTimeoutSec * 1000;
export const rebaseTimeoutMs = () => current.rebaseTimeoutSec * 1000;
/** characters kept per output stream */
export const outputCap = () => current.outputCapMb * 1024 * 1024;
