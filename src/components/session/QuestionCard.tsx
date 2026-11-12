import { useState } from 'react';
import { Button } from '@dynatrace/strato-components/buttons';
import { Chip } from '@dynatrace/strato-components/content';
import { Text } from '@dynatrace/strato-components/typography';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { CheckmarkIcon } from '@dynatrace/strato-icons';
import type { AskQuestion } from '../../model/types';
import type { ToolMessage } from '../../model/session';
import { answerQuestion } from '../../state/actions';
import { subduedText } from './meta';

interface Choice {
  /** selected option labels */
  picked: string[];
  /** "Other…" chosen, and its text */
  other: boolean;
  text: string;
}

const empty: Choice = { picked: [], other: false, text: '' };

const isAnswered = (c: Choice) => c.picked.length > 0 || (c.other && c.text.trim() !== '');

function Option({ multi, checked, disabled, label, description, onClick }: { multi: boolean; checked: boolean; disabled?: boolean; label: string; description?: string; onClick: () => void }) {
  return (
    <button type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={checked} disabled={disabled} className="cx-btn cx-ask-opt" onClick={onClick}>
      <span className="cx-ask-mark" data-multi={multi} />
      <span style={{ minWidth: 0 }}>
        <Text style={{ display: 'block', fontWeight: 600 }}>{label}</Text>
        {description && (
          <Text textStyle="small" style={{ ...subduedText, display: 'block' }}>
            {description}
          </Text>
        )}
      </span>
    </button>
  );
}

function Question({ q, choice, disabled, onChange }: { q: AskQuestion; choice: Choice; disabled: boolean; onChange: (c: Choice) => void }) {
  const toggle = (label: string) => {
    if (q.multiSelect) onChange({ ...choice, picked: choice.picked.includes(label) ? choice.picked.filter((l) => l !== label) : [...choice.picked, label] });
    else onChange({ picked: [label], other: false, text: choice.text });
  };
  const toggleOther = () => (q.multiSelect ? onChange({ ...choice, other: !choice.other }) : onChange({ picked: [], other: true, text: choice.text }));
  return (
    <div className="cx-ask-q" role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {q.header && (
          <Chip color="primary" size="condensed">
            {q.header}
          </Chip>
        )}
        <Text style={{ fontWeight: 600 }}>{q.question}</Text>
        {q.multiSelect && (
          <Text textStyle="small" style={subduedText}>
            select any
          </Text>
        )}
      </div>
      {q.options.map((o) => (
        <Option key={o.label} multi={q.multiSelect} checked={choice.picked.includes(o.label)} disabled={disabled} label={o.label} description={o.description} onClick={() => toggle(o.label)} />
      ))}
      <Option multi={q.multiSelect} checked={choice.other} disabled={disabled} label="Other…" onClick={toggleOther} />
      {choice.other && (
        <textarea
          className="cx-ask-other"
          rows={2}
          autoFocus
          disabled={disabled}
          value={choice.text}
          placeholder="Your own answer"
          aria-label={`Other answer for: ${q.question}`}
          onChange={(e) => onChange({ ...choice, text: e.target.value })}
        />
      )}
    </div>
  );
}

/** Claude's AskUserQuestion as a card: answer it while open, a read-only summary afterwards. */
export function QuestionCard({ sessionId, msg }: { sessionId: string; msg: ToolMessage }) {
  const questions = msg.questions ?? [];
  const [choices, setChoices] = useState<Choice[]>(() => questions.map(() => empty));
  const [sent, setSent] = useState(false);
  const open = msg.status === 'running';

  if (!open) {
    const unanswered = msg.status === 'error';
    return (
      <div className="cx-ask" data-done="true">
        {questions.map((q) => (
          <div key={q.question} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            {q.header && (
              <Chip color="neutral" size="condensed">
                {q.header}
              </Chip>
            )}
            <Text textStyle="small" style={subduedText}>
              {q.question}
            </Text>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {!unanswered && <CheckmarkIcon style={{ color: Colors.Icon.Success.Default }} aria-hidden />}
              <Text style={{ fontWeight: 600, ...(unanswered ? subduedText : null) }}>{unanswered ? 'No answer' : (msg.answers?.[q.question] ?? 'Answered')}</Text>
            </span>
          </div>
        ))}
      </div>
    );
  }

  const ready = choices.every(isAnswered);
  const submit = () => {
    setSent(true);
    const answers = Object.fromEntries(
      questions.map((q, i) => {
        const c = choices[i];
        const parts = [...c.picked, ...(c.other ? [c.text.trim()] : [])];
        return [q.question, q.multiSelect ? parts : parts[0]];
      }),
    );
    void answerQuestion(sessionId, msg.id, answers);
  };

  return (
    <div className="cx-ask" role="form" aria-label="Claude has a question">
      {questions.map((q, i) => (
        <Question key={q.question} q={q} choice={choices[i]} disabled={sent} onChange={(c) => setChoices((all) => all.map((x, j) => (j === i ? c : x)))} />
      ))}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Text textStyle="small" style={subduedText}>
          Or type your answer in the box below.
        </Text>
        <span style={{ flex: 'none', marginLeft: 'auto' }}>
          <Button variant="accent" color="primary" size="condensed" disabled={!ready || sent} onClick={submit}>
            Submit
          </Button>
        </span>
      </div>
    </div>
  );
}
