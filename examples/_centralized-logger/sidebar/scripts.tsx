import React from 'react'
import {createRoot} from 'react-dom/client'
import SidebarApp from './SidebarApp'
import './styles.css'

// Do not log sidebar's own console; only render the UI
const root = createRoot(document.getElementById('root')!)
root.render(<SidebarApp />)
