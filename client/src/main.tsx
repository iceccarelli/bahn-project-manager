// Self-hosted variable Inter: one 48 kB woff2 covering every weight 100-900,
// so font-black (900, used 42x) renders as a real weight instead of faux bold.
import "@fontsource-variable/inter";
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
