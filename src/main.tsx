import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { PlatformAdminApp } from './components/PlatformAdminApp.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname.startsWith('/platform-admin') ? <PlatformAdminApp /> : <App />}
  </StrictMode>,
);
