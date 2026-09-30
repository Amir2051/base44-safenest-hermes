import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { ThemeProvider } from '@/lib/ThemeContext'
import { initPrivacyGuard, isAnalyticsAllowed, isChatAllowed } from '@/lib/PrivacyGuard'
import { initGA } from '@/lib/analytics'

// Initialize GA4 once at app startup (guarded by consent)
initGA()

// Initialize privacy protection before anything else loads
initPrivacyGuard({
  blockAnalytics: !isAnalyticsAllowed(),
  blockChat: !isChatAllowed(),
})

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <ThemeProvider>
    <App />
  </ThemeProvider>
  // </React.StrictMode>,
)

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}