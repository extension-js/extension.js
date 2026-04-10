// Lightweight "ready" banner message for browser launch flows.
// Inlined from dev-server/messages.ts to avoid importing the full bundler package.

import colors from 'pintor'

export function ready(mode: 'development' | 'production', browser: string) {
  const key = String(browser || '').toLowerCase()
  const extensionOutput =
    key === 'firefox' ||
    key === 'gecko-based' ||
    key === 'firefox-based' ||
    key === 'edge'
      ? 'Add-on'
      : 'Extension'
  const cap =
    key === 'firefox' || key === 'gecko-based' || key === 'firefox-based'
      ? 'Firefox'
      : String(browser || '')
          .charAt(0)
          .toUpperCase() + String(browser || '').slice(1)
  const pretty = colors.green('ready for ' + mode)
  return `${colors.gray('⏵⏵⏵')} ${cap} ${extensionOutput} ${pretty}.`
}
