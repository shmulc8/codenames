if (import.meta.env.DEV) {
  import("react-grab");
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './theme/nocturne-tokens.css';
import './theme/tokens.css';
import './theme/game.css';

async function enableMocking(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCKS !== '1') return;

  try {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  } catch (error) {
    console.warn('Mock service worker could not be started.', error);
  }
}

async function bootstrap(): Promise<void> {
  await enableMocking();

  const root = document.getElementById('root');

  if (!root) {
    throw new Error('Missing #root application mount point');
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
