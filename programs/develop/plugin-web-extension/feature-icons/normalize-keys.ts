// ██╗ ██████╗ ██████╗ ███╗   ██╗███████╗
// ██║██╔════╝██╔═══██╗████╗  ██║██╔════╝
// ██║██║     ██║   ██║██╔██╗ ██║███████╗
// ██║██║     ██║   ██║██║╚██╗██║╚════██║
// ██║╚██████╗╚██████╔╝██║ ╚████║███████║
// ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {FilepathList} from '../../types'

export function iconValuesToStrings(response: unknown): string[] {
  if (!response) return []

  if (typeof response === 'string') return [response]

  if (Array.isArray(response)) {
    return response
      .flatMap((value) => {
        if (typeof value === 'string') return [value]

        if (value && typeof value === 'object') {
          return Object.values(value as Record<string, unknown>)
        }

        return []
      })
      .filter((value): value is string => typeof value === 'string')
  }

  if (typeof response === 'object') {
    return Object.values(response as Record<string, unknown>).filter(
      (value): value is string => typeof value === 'string'
    )
  }

  return []
}

export function normalizeIconIncludeKeys(
  icons?: Record<string, unknown>
): FilepathList {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(icons || {})) {
    if (key === 'action') {
      out['action/default_icon'] = value
    } else if (key === 'browser_action') {
      out['browser_action/default_icon'] = value
    } else if (key === 'page_action') {
      out['page_action/default_icon'] = value
    } else if (key === 'sidebar_action') {
      out['sidebar_action/default_icon'] = value
    } else {
      out[key] = value
    }
  }

  return out as FilepathList
}
