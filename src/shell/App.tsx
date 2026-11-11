import { ProgressCircle } from '@dynatrace/strato-components/content';
import { Flex, Page } from '@dynatrace/strato-components/layouts';
import { Text } from '@dynatrace/strato-components/typography';
import { useCortex } from '../state/store';
import { MainView } from './MainView';
import { Sidebar } from './Sidebar';

export function App() {
  const ready = useCortex((s) => s.ready);
  if (!ready) {
    return (
      <Flex flexDirection="column" alignItems="center" justifyContent="center" gap={12} style={{ height: '100vh' }}>
        <ProgressCircle aria-label="Loading" />
        <Text>Loading your work…</Text>
      </Flex>
    );
  }
  return (
    <Page>
      <Page.Sidebar preferredWidth={400} minWidth={320} resizable>
        <Sidebar />
      </Page.Sidebar>
      <Page.Main>
        <MainView />
      </Page.Main>
    </Page>
  );
}
