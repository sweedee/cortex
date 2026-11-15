import { describe, expect, it } from 'vitest';
import { isExecutablePath, normPath, rootRefusal, Roots, sensitiveReason, type PathEnv } from './pathPolicy';

const win: PathEnv = { platform: 'win32', home: 'C:\\Users\\me', userData: 'C:\\Users\\me\\.cortex', programData: 'C:\\ProgramData' };
const mac: PathEnv = { platform: 'darwin', home: '/Users/me', userData: '/Users/me/.cortex' };
const linux: PathEnv = { platform: 'linux', home: '/home/me', userData: '/home/me/.cortex' };

describe('normPath', () => {
  it('resolves .. and trailing separators, folds case on Windows / macOS only', () => {
    expect(normPath('C:\\Work\\repo\\..\\Other\\', win)).toBe('c:\\work\\other');
    expect(normPath('C:\\', win)).toBe('c:\\');
    expect(normPath('/home/me/Repo/', linux)).toBe('/home/me/Repo');
    expect(normPath('/Users/me/Repo', mac)).toBe('/users/me/repo');
  });
});

describe('sensitiveReason', () => {
  it('refuses home dot-entries but not Cortex’s own data folder', () => {
    expect(sensitiveReason('C:\\Users\\me\\.ssh\\id_ed25519', win)).toMatch(/\.ssh/);
    expect(sensitiveReason('C:\\Users\\me\\.aws', win)).toMatch(/\.aws/);
    expect(sensitiveReason('C:\\Users\\Me\\.GNUPG\\x', win)).toMatch(/gnupg/i);
    expect(sensitiveReason('/home/me/.bashrc', linux)).toMatch(/bashrc/);
    expect(sensitiveReason('/home/me/.config/autostart/x.desktop', linux)).toBeDefined();
    expect(sensitiveReason('C:\\Users\\me\\.cortex\\workspace.json', win)).toBeUndefined();
    expect(sensitiveReason('/home/me/code/repo/.git/config', linux)).toBeUndefined();
  });

  it('refuses autostart and shell-profile locations', () => {
    expect(sensitiveReason('C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.bat', win)).toBeDefined();
    expect(sensitiveReason('C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp', win)).toBeDefined();
    expect(sensitiveReason('C:\\Users\\me\\Documents\\WindowsPowerShell\\profile.ps1', win)).toBeDefined();
    expect(sensitiveReason('/Users/me/Library/LaunchAgents/x.plist', mac)).toBeDefined();
    expect(sensitiveReason('/etc/passwd', linux)).toBeDefined();
  });

  it('can’t be escaped with ..', () => {
    expect(sensitiveReason('C:\\Users\\me\\code\\..\\.ssh\\id_rsa', win)).toBeDefined();
  });
});

describe('rootRefusal', () => {
  it('refuses filesystem roots, the home folder and its parents', () => {
    expect(rootRefusal('C:\\', win)).toMatch(/root/);
    expect(rootRefusal('/', linux)).toMatch(/root/);
    expect(rootRefusal('C:\\Users\\me', win)).toMatch(/home/);
    expect(rootRefusal('C:\\Users\\me\\', win)).toMatch(/home/);
    expect(rootRefusal('C:\\Users', win)).toMatch(/home/);
    expect(rootRefusal('/home', linux)).toMatch(/home/);
  });

  it('accepts project folders, refuses sensitive ones', () => {
    expect(rootRefusal('C:\\Users\\me\\code\\cortex', win)).toBeUndefined();
    expect(rootRefusal('D:\\work', win)).toBeUndefined();
    expect(rootRefusal('/home/me/code', linux)).toBeUndefined();
    expect(rootRefusal('C:\\Users\\me\\.ssh', win)).toBeDefined();
  });
});

describe('Roots', () => {
  it('always allows user data; otherwise only inside registered or added roots', () => {
    const r = new Roots(win);
    expect(r.refusal('C:\\Users\\me\\.cortex\\workspace.json')).toBeUndefined();
    expect(r.refusal('C:\\Users\\me\\code\\repo\\package.json')).toMatch(/outside/);
    expect(r.set(['C:\\Users\\me\\code\\repo', 'C:\\Users\\me', 'C:\\Users\\me\\.ssh'])).toEqual([
      { path: 'C:\\Users\\me', reason: expect.stringMatching(/home/) },
      { path: 'C:\\Users\\me\\.ssh', reason: expect.stringMatching(/\.ssh/) },
    ]);
    expect(r.refusal('C:\\Users\\me\\code\\repo\\package.json')).toBeUndefined();
    expect(r.refusal('c:/users/ME/Code/Repo/records/a.md')).toBeUndefined();
    // a sibling with the same prefix is not inside
    expect(r.refusal('C:\\Users\\me\\code\\repo2\\x')).toMatch(/outside/);
    expect(r.refusal('C:\\Users\\me\\code\\repo\\..\\other')).toMatch(/outside/);
    expect(() => r.check('C:\\Users\\me\\notes.txt', 'cwd')).toThrow(/cwd not allowed/);
  });

  it('set() replaces the registered roots; add() keeps picked ones', () => {
    const r = new Roots(linux);
    r.set(['/home/me/a']);
    expect(r.add('/home/me/picked')).toBe(true);
    expect(r.add('/')).toBe(false);
    r.set(['/home/me/b']);
    expect(r.refusal('/home/me/a/x')).toMatch(/outside/);
    expect(r.refusal('/home/me/b/x')).toBeUndefined();
    expect(r.refusal('/home/me/picked/x')).toBeUndefined();
  });

  it('sensitive paths stay refused inside a root', () => {
    const r = new Roots(linux);
    r.set(['/home/me/code']);
    expect(r.refusal('/home/me/code/../.ssh/id_rsa')).toMatch(/\.ssh/);
  });
});

describe('isExecutablePath', () => {
  it('flags launchers and scripts', () => {
    for (const p of ['C:\\x\\setup.exe', 'C:\\x\\run.BAT', 'C:\\x\\a.cmd', 'C:\\x\\link.lnk', 'C:\\x\\s.ps1', 'C:\\x\\v.vbs', 'C:\\x\\i.msi', 'C:\\x\\a.js', '/x/Thing.app', '/x/run.sh', '/x/a.command', 'C:\\x\\evil.exe.', 'C:\\x\\evil.exe ', 'C:\\x\\a.txt:hidden.exe']) {
      expect(isExecutablePath(p), p).toBe(true);
    }
  });

  it('lets folders and documents through', () => {
    for (const p of ['C:\\x\\repo', 'C:\\x\\notes.md', '/x/report.pdf', '/x/.gitignore', '/x/image.png', 'C:\\x\\data.json']) {
      expect(isExecutablePath(p), p).toBe(false);
    }
  });
});
