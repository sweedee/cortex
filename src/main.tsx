import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from '@dynatrace/strato-components/core';
import { App } from './shell/App';
import { initRouter, syncHash } from './state/router';
import { subscribe } from './state/store';
import { boot } from './state/sync';
import { initTodos } from './state/todos';
import './index.css';

initTodos();

// Load everything from the services, then let the URL decide what to show.
// (The router needs the work items to exist before it can resolve a deep link.)
void boot().then(() => {
  initRouter();
  subscribe(syncHash);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot>
      <App />
    </AppRoot>
  </StrictMode>,
);
