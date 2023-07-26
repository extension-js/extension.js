import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import NewTabApp from './NewTabApp'

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

root.render(
  <React.StrictMode>
    <NewTabApp />
  </React.StrictMode>
)
