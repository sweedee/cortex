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
import './index.css';

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
