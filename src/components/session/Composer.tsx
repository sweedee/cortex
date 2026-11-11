import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Text } from '@dynatrace/strato-components/typography';
import { ArrowUpIcon, StopIcon } from '@dynatrace/strato-icons';
import { subduedText } from './meta';

interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  running?: boolean;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  hint?: ReactNode;
}

export function Composer({ onSend, onStop, running, placeholder = 'Message Claude…', rows = 1, autoFocus, hint }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  return (
    <div className="cx-composer">
      <textarea
        ref={ref}
        rows={rows}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <Text textStyle="small" style={subduedText}>
          {hint ?? 'Enter to send · Shift+Enter for a new line'}
        </Text>
        <div style={{ display: 'flex', gap: 8 }}>
          {running && onStop && (
            <Button variant="default" size="condensed" onClick={onStop}>
              <Button.Prefix>
                <StopIcon />
              </Button.Prefix>
              Stop
            </Button>
          )}
          <Button variant="accent" color="primary" size="condensed" disabled={!text.trim()} onClick={send} aria-label="Send">
            <Button.Prefix>
              <ArrowUpIcon />
            </Button.Prefix>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
