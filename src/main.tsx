import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installAppViewportGuards } from './lib/viewport.ts';

if (typeof window !== 'undefined' && 'caches' in window) {
  void caches.delete('supabase-api-cache');
}

installAppViewportGuards();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
