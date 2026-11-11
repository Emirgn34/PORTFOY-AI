import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import './index.css';

// Service worker uygulama AÇILIŞINDA kaydedilir ki push altyapısı kullanıcının
// Trade/Portföy sayfasına girmesini beklemesin. İzin/abonelik İSTENMEZ — onlar
// kullanıcının düğme tıklamasıyla başlar (bkz. services/pushSubscription.js).
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
