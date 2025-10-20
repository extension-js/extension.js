import React from 'react'
import {applyTheme} from '@/lib/utils'
import {createRoot} from 'react-dom/client'
import SidebarApp from './SidebarApp'
import '../../styles.css'

applyTheme()

const root = createRoot(document.getElementById('root')!)
root.render(<SidebarApp />)
