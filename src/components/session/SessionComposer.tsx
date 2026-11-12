import { openQuestion } from '../../model/session';
import type { AgentSession } from '../../model/types';
import { sendMessage, setSessionOptions, stopSession } from '../../state/actions';
import { Composer } from './Composer';
import { StatusLine } from './StatusLine';

/** The composer of a session (with model / effort pickers) and its status line underneath. */
export function SessionComposer({ session, placeholder = 'Reply to Claude…' }: { session: AgentSession; placeholder?: string }) {
  const running = session.status === 'running';
  const asking = !!openQuestion(session.messages);
  return (
    <>
      <Composer
        key={session.id}
        running={running || asking} // Stop also cancels an open question
        onStop={() => stopSession(session.id)}
        onSend={(t) => void sendMessage(session.id, t)}
        placeholder={asking ? 'Answer above, or type your answer here…' : running ? 'Claude is working. Send a message to steer it…' : placeholder}
        hint={asking ? 'A typed message answers Claude' : undefined}
        options={{ model: session.model, effort: session.effort, disabled: running || asking, onChange: (patch) => setSessionOptions(session.id, patch) }}
      />
      <StatusLine session={session} />
    </>
  );
}
