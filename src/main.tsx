import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary
    fallbackTitle="Battle Spirits App encountered an error"
    resetLabel="Reload View"
    onReset={() => window.location.reload()}
  >
    <App />
  </ErrorBoundary>
);
