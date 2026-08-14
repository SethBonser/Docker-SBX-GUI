import React from 'react'
import ReactDOM from 'react-dom/client'
import log from 'electron-log/renderer'
import App from './App'
import './styles/index.css'

// Catches uncaught errors/rejections in this window and forwards them to the main process's
// log file — same "quiet capture, no dialog" posture as the main-process setup (src/main/index.ts).
log.errorHandler.startCatching({ showDialog: false })

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
