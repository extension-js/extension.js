import React from 'react'
import {applyTheme} from '@/lib/utils'
import {createRoot} from 'react-dom/client'
import SidebarApp from './SidebarApp'
import '../../src/styles.css'

// Apply theme early for sidebar UI
applyTheme()

// Do not log sidebar's own console; only render the UI
const root = createRoot(document.getElementById('root')!)
root.render(<SidebarApp />)
