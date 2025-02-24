import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'

if (document.readyState === 'complete') initial()
else
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'complete') initial()
  })
function initial() {
  const root = document.createElement('div')
  const shadow = root.attachShadow({ mode: 'open' })
  document.body.appendChild(root)

  const style = new CSSStyleSheet()
  shadow.adoptedStyleSheets = [style]
  fetchCSS().then((response) => style.replace(response))

  if (import.meta.webpackHot) {
    import.meta.webpackHot.accept('./style.css', () => {
      fetchCSS().then((response) => style.replace(response))
    })
  }

  createRoot(shadow).render(<App />)
}
declare global {
  interface ImportMeta {
    webpackHot?: any
  }
}

async function fetchCSS() {
  const response = await fetch(new URL('./style.css', import.meta.url))
  return response.ok ? response.text() : Promise.reject(response.text())
}
