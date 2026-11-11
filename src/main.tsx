import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from '@dynatrace/strato-components/core';
import { App } from './shell/App';
import { initRouter, syncHash } from './state/router';
import { subscribe } from './state/store';
import { initTodos } from './state/todos';
import './index.css';

initTodos();
initRouter();
subscribe(syncHash);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot>
      <App />
    </AppRoot>
  </StrictMode>,
);
