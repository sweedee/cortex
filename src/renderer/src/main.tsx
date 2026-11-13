import './runtime';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from '@dynatrace/strato-components/core';
import { ToastContainer } from '@dynatrace/strato-components/notifications';
import { Canvas } from './canvas/Canvas';
import { ChatBox } from './chat/ChatBox';
import { Dialogs } from './overlays/Dialogs';
import { Hud } from './overlays/Hud';
import { Sidebar } from './overlays/Sidebar';
import './desktop';
import { loadWorkspace, startAutosave } from './persist';
import './index.css';

async function boot() {
  // load before the first render, so the layout warms up on the stored world, not the seed
  await loadWorkspace();
  startAutosave();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppRoot>
        <Canvas />
        <Hud />
        <Sidebar />
        <ChatBox />
        <Dialogs />
        <ToastContainer />
      </AppRoot>
    </StrictMode>,
  );
}
void boot();
