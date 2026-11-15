/** The keyboard shortcuts overlay (`?`, or the keyboard button in the HUD), listed from ui/shortcuts.ts. */
import { useSyncExternalStore } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Modal } from '@dynatrace/strato-components/overlays';
import { isMac, keyLabel, SCOPE_LABEL, shortcutsIn, type ShortcutScope } from '../ui/shortcuts';

let open = false;
const listeners = new Set<() => void>();
const set = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};
export const openShortcuts = () => set(true);
const close = () => set(false);

const SCOPES: ShortcutScope[] = ['canvas', 'bubble'];

/** Mount once. */
export function ShortcutsHelp() {
  const shown = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => open,
  );
  if (!shown) return null;
  const mac = isMac();
  return (
    <Modal
      title="Keyboard shortcuts"
      show
      size="small"
      onDismiss={close}
      footer={
        <Flex justifyContent="flex-end">
          <Button onClick={close}>Close</Button>
        </Flex>
      }
    >
      {SCOPES.map((scope) => (
        <section key={scope} className="shortcuts-section">
          <h3 className="shortcuts-scope">{SCOPE_LABEL[scope]}</h3>
          <dl className="shortcuts-list">
            {shortcutsIn(scope).map((s) => (
              <div key={s.id} className="shortcuts-row">
                <dt>
                  {s.keys.map((b, i) => (
                    <kbd key={i}>{keyLabel(b, mac)}</kbd>
                  ))}
                </dt>
                <dd>{s.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Modal>
  );
}
