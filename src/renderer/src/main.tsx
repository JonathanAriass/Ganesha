import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import App from './App'
import { themeHint } from './lib/theme'
import { densityHint } from './lib/density'

// Set before first paint so a light-theme user doesn't get a dark flash.
document.documentElement.dataset.theme = themeHint()
document.documentElement.dataset.density = densityHint()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
