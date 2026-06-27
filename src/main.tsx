/**
 * React Application Entry Point
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { BRAND } from '@shared/brand';
import brandLogo from '@/assets/brand-logo.generated.svg';
import './i18n';
import './styles/globals.css';
import 'katex/dist/katex.min.css';

// Static index.html ships a neutral title; set the real brand title at runtime
// so the window/tab reflects the active white-label brand.
document.title = BRAND.appName;

// index.html ships no favicon (the root favicon.svg was removed); point it at
// the active brand logo so the tab/taskbar icon matches the white-label brand.
const favicon =
  document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
  document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
favicon.type = 'image/svg+xml';
favicon.href = brandLogo;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
