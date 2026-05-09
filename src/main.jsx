import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import WhoopCallbackHandler from './features/whoop/WhoopCallbackHandler';

const isWhoopCallback = window.location.pathname === '/auth/whoop/callback';

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    {isWhoopCallback ? <WhoopCallbackHandler /> : <App />}
  </ErrorBoundary>
);
