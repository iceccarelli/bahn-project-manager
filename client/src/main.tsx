// Self-hosted variable Inter: one 48 kB woff2 covering every weight 100-900,
// so font-bold (900, used 42x) renders as a real weight instead of faux bold.
import "@fontsource-variable/inter";
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installMotionSwitch } from './lib/motion'

/*
 * Before the first render, not after.
 *
 * Every rule that hides a not-yet-revealed section is scoped under
 * <html data-motion="on">. Setting the attribute here means the very first
 * paint already knows whether it is allowed to animate — set it in an effect
 * instead and the page paints once fully visible, then blanks itself out to
 * play the reveal, which is the worst of both.
 */
installMotionSwitch()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
