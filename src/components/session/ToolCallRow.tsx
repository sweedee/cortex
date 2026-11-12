import { useState } from 'react';
import { Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { CheckmarkIcon, ChevronDownIcon, ChevronRightIcon, CriticalIcon } from '@dynatrace/strato-icons';
import type { SessionMessage } from '../../model/types';
import { clock, isFresh, subduedText } from './meta';

type ToolMsg = Extract<SessionMessage, { role: 'tool' }>;

function StatusIcon({ status }: { status: ToolMsg['status'] }) {
  if (status === 'running') return <span className="cx-spinner" aria-label="Running" />;
  if (status === 'error') return <CriticalIcon style={{ color: Colors.Icon.Critical.Default }} aria-label="Failed" />;
  return <CheckmarkIcon style={{ color: Colors.Icon.Success.Default }} aria-label="Succeeded" />;
}

export function ToolCallRow({ msg }: { msg: ToolMsg }) {
  const [open, setOpen] = useState(false);
  const expandable = !!msg.detail;
  return (
    <div className="cx-tool" data-fresh={isFresh(msg.at)}>
      <button
        type="button"
        className="cx-btn cx-tool-row"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((o) => !o)}
        title={msg.summary}
      >
        <span style={subduedText}>{expandable ? open ? <ChevronDownIcon /> : <ChevronRightIcon /> : null}</span>
        <StatusIcon status={msg.status} />
        <Text textStyle="small" style={{ fontWeight: 600 }}>
          {msg.tool}
        </Text>
        <Text textStyle="small" className="cx-ellipsis" style={{ fontFamily: 'monospace', ...subduedText }}>
          {msg.summary}
        </Text>
        <Text textStyle="small" style={subduedText}>
          {clock(msg.at)}
        </Text>
      </button>
      {open && msg.detail && (
        <pre className="cx-tool-detail" style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {msg.detail.split('\n').map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </pre>
      )}
    </div>
  );
}
