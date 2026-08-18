import './platform/install';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../../src/components/error-boundary';
import { WebApp } from './WebApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('CineGen web root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <WebApp />
    </ErrorBoundary>
  </StrictMode>,
);
