import { App } from './App.tsx'
import { createRoot } from 'react-dom/client'

setTimeout(initial, 1000)
function initial() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  createRoot(root).render(<App />)
}
