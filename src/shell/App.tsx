import { Page } from '@dynatrace/strato-components/layouts';
import { MainView } from './MainView';
import { Sidebar } from './Sidebar';

export function App() {
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
