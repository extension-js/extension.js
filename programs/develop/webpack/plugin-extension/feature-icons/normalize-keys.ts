// ██╗ ██████╗ ██████╗ ███╗   ██╗███████╗
// ██║██╔════╝██╔═══██╗████╗  ██║██╔════╝
// ██║██║     ██║   ██║██╔██╗ ██║███████╗
// ██║██║     ██║   ██║██║╚██╗██║╚════██║
// ██║╚██████╗╚██████╔╝██║ ╚████║███████║
// ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import type {FilepathList} from '../../webpack-types'

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
