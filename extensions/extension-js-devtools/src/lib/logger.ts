import type {LoggerContext, LogEvent} from '../types/logger'

export function formatMessageParts(parts: unknown[]): string {
  try {
    const unFormattedParts = parts.map((part) => {
      if (typeof part === 'string') return part
      if (part instanceof Error) return `${part.name}: ${part.message}`

      try {
        return JSON.stringify(part)
      } catch {
        return String(part)
      }
    })

    return unFormattedParts.join(' ')
  } catch {
    return String(parts)
  }
}

export function getContextColor(ctx: LoggerContext): string {
  switch (ctx) {
    case 'background':
      return '#10b981'
    case 'content':
      return '#ec4899'
    case 'page':
      return '#d97706'
    case 'sidebar':
      return '#0ea5a4'
    case 'popup':
      return '#84cc16'
    case 'options':
      return '#0ea5e9'
    case 'devtools':
      return '#b45309'
    default:
      return '#6b7280'
  }
}

export function getContextColorClass(ctx: LoggerContext): string {
  switch (ctx) {
    case 'background':
      return 'text-emerald-500'
    case 'content':
      return 'text-pink-500'
    case 'page':
      return 'text-amber-600'
    case 'sidebar':
      return 'text-teal-500'
    case 'popup':
      return 'text-lime-500'
    case 'options':
      return 'text-sky-500'
    case 'devtools':
      return 'text-amber-700'
    default:
      return 'text-gray-500'
  }
}

export function exportLogs(
  logEvents: LogEvent[],
  exportFormat: 'json' | 'ndjson'
) {
  try {
    let logBlob: Blob

    if (exportFormat === 'json') {
      logBlob = new Blob([JSON.stringify(logEvents, null, 2)], {
        type: 'application/json'
      })
    } else {
      const ndjsonString = logEvents
        .map((logEvent) => JSON.stringify(logEvent))
        .join('\n')
      logBlob = new Blob([ndjsonString], {type: 'application/x-ndjson'})
    }

    const objectUrl = URL.createObjectURL(logBlob)
    const downloadLink = document.createElement('a')
    downloadLink.href = objectUrl
    downloadLink.download = `logs.${exportFormat}`
    downloadLink.click()
    URL.revokeObjectURL(objectUrl)
  } catch {}
}
