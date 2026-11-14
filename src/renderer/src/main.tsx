import './runtime';
// the kind registry first: it registers what the store's filter needs to know about kinds
import './kinds/registry';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRoot } from '@dynatrace/strato-components/core';
import { showToast, ToastContainer } from '@dynatrace/strato-components/notifications';
import { Canvas } from './canvas/Canvas';
import { ChatBox } from './chat/ChatBox';
import { queryClient } from './data/queryClient';
import { Dialogs } from './overlays/Dialogs';
import { Hud } from './overlays/Hud';
import { Sidebar } from './overlays/Sidebar';
import { FormHost } from './ui/form';
import './desktop';
import { loadWorkspace, startAutosave } from './persist';
import { startSync } from './sync';
import './debug';
import './index.css';

async function boot() {
  // load before the first render, so the layout warms up on the stored world, not the seed
  const report = await loadWorkspace();
  startAutosave();
  startSync();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppRoot>
          <Canvas />
          <Hud />
          <Sidebar />
          <ChatBox />
          <Dialogs />
          <FormHost />
          <ToastContainer />
        </AppRoot>
      </QueryClientProvider>
    </StrictMode>,
  );
  const w = report.warning;
  if (w) setTimeout(() => showToast({ type: 'warning', title: w.title, message: w.message, lifespan: 8000 }), 400);
}
void boot();
