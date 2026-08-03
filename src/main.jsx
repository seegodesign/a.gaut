import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// Find <div id="root"> in index.html, create a React application inside it,
// and render our top-level App component.
createRoot(document.getElementById('root')).render(
  // StrictMode adds extra development checks. It does not render visible UI.
  <StrictMode>
    <App />
  </StrictMode>,
)
