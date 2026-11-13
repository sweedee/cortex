/** App-level queries (`app:info`, `integrations:config`). */
import { useQuery } from '@tanstack/react-query';
import { native } from '../native';
import { ready } from './ops';
import { qk } from './queryKeys';

/** Platform / version info of the running app (`app:info`). Never changes while running. */
export function useAppInfo() {
  return useQuery({ queryKey: qk.app.info(), queryFn: () => native.app.info(), staleTime: Infinity });
}

/** Effective integration config of main (Jira CLI, AI-review comment, Renovate app, claude binary). */
export function useIntegrationConfig() {
  return useQuery({ queryKey: qk.app.config(), queryFn: () => native.integrations.config(), enabled: ready(), staleTime: Infinity });
}
