import React from 'react';
import ReactDOM from 'react-dom/client';
import { Amplify } from 'aws-amplify';
import { authConfig } from './auth-config';
import App from './App';
import './index.css';

if (authConfig.Auth.Cognito.userPoolId) {
  Amplify.configure(authConfig);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register Service Worker for PWA installation
if ('serviceWorker' in navigator && import.meta.env.PROD !== undefined) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('ServiceWorker registration error:', err);
    });
  });
}

