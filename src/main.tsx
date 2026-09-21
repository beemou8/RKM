import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyDomReconciliationPatch } from './lib/domPatch';
import 'leaflet/dist/leaflet.css';
import './index.css';

applyDomReconciliationPatch();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
