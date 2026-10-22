// Banditur desktop app — entry point. The UI is Svelte 5 (src/App.svelte);
// the Tauri commands it calls live in src-tauri/src (see lib.rs).

import './styles/tokens.css';
import './styles/base.css';
import './styles/legacy-tools.css';
import { mount } from 'svelte';
import App from './App.svelte';

async function start() {
  // Dev only: open http://127.0.0.1:5173/?mock in a browser to click through
  // every screen with sample data (no Tauri, no backend needed).
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) {
    const { installMock } = await import('./lib/mock.js');
    installMock();
  }
  mount(App, { target: document.getElementById('app') });
}

start();
