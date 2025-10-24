import {createRoot} from 'react-dom/client'
import SidebarApp from './SidebarApp'
import {applyTheme, loadStoredTheme} from '@/lib/utils'
import '@/styles.css'

// Apply saved theme or default theme on load
;(async () => {
  const savedTheme = await loadStoredTheme()
  applyTheme(savedTheme || undefined)
})()

// Track if the user has set a theme, else follow system preference
let userSetTheme = false

chrome.storage.local.get(['logger_theme'], (data) => {
  userSetTheme = data.logger_theme === 'light' || data.logger_theme === 'dark'
})

const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)')

const handleSystemThemeChange = (event: MediaQueryListEvent) => {
  if (!userSetTheme) {
    applyTheme(event.matches ? 'dark' : 'light')
  }
}

prefersDarkScheme.addEventListener?.('change', handleSystemThemeChange)

// Render the sidebar app
const rootElement = document.getElementById('root')
const root = createRoot(rootElement!)
root.render(<SidebarApp />)
