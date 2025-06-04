import React from 'react'
import {createRoot} from 'react-dom/client'
import SidebarApp from './SidebarApp'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(<SidebarApp />)
