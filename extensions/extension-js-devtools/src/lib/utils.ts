import {clsx, type ClassValue} from 'clsx'
import {twMerge} from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type Theme = 'light' | 'dark'

function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch {}
  return null
}

// Async loader that prefers chrome.storage.local over localStorage
export async function loadStoredTheme(): Promise<Theme | null> {
  // Prefer chrome.storage.local if available, else fallback to localStorage
  const chromeStorage: typeof chrome.storage.local | undefined =
    typeof chrome !== 'undefined' &&
    chrome.storage &&
    chrome.storage.local &&
    typeof chrome.storage.local.get === 'function'
      ? chrome.storage.local
      : undefined

  if (chromeStorage) {
    const data = await new Promise<{logger_theme?: unknown}>((resolve) => {
      chromeStorage.get(['logger_theme'], (res) => resolve(res || {}))
    })
    const val = data?.logger_theme
    if (val === 'light' || val === 'dark') {
      return val
    }
  }

  return getStoredTheme()
}

export function detectPreferredTheme(): Theme {
  const stored = getStoredTheme()
  if (stored) return stored

  if (typeof window !== 'undefined' && 'matchMedia' in window) {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    } catch {}
  }
  return 'light'
}

export function applyTheme(
  theme?: Theme,
  root: HTMLElement = document.documentElement
): Theme {
  const resolved = theme ?? detectPreferredTheme()
  if (resolved === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
  return resolved
}

export function setTheme(
  theme: Theme,
  root: HTMLElement = document.documentElement
): Theme {
  localStorage.setItem('theme', theme)
  chrome.storage.local.set({logger_theme: theme})
  return applyTheme(theme, root)
}
