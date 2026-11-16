import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

if (typeof window !== 'undefined') {
  registerSW({
    immediate: true,
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('spiritsdex:offline-ready'));
    },
    onRegisterError(error) {
      console.warn('Service worker registration skipped or failed:', error);
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary
    fallbackTitle="Battle Spirits App encountered an error"
    resetLabel="Reload View"
    onReset={() => window.location.reload()}
  >
    <App />
  </ErrorBoundary>
);
