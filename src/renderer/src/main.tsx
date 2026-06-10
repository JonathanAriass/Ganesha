import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import App from './App'
import { themeHint } from './lib/theme'

// Set before first paint so a light-theme user doesn't get a dark flash.
document.documentElement.dataset.theme = themeHint()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
