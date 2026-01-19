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
