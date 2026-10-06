// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {stripBom} from '../../../lib/parse-json-safe'
import type {DevOptions, FilepathList, Manifest} from '../../../types'
import {declaredResourceSource} from './resolve-war'

// A source page listed in web_accessible_resources is framed by its listed
// path, so it is a page entry emitted there. Copied as written, its script
// and stylesheet sources would never reach the output.
export function discoverWebAccessiblePages(
  manifestPath: string,
  browser: DevOptions['browser'] = 'chrome',
  projectPath?: string
): FilepathList {
  let declared: unknown

  try {
    declared = (
      filterKeysForThisBrowser(
        JSON.parse(
          stripBom(fs.readFileSync(manifestPath, 'utf-8'))
        ) as Manifest,
        browser
      ) as {web_accessible_resources?: unknown}
    ).web_accessible_resources
  } catch {
    return {}
  }

  if (!Array.isArray(declared)) return {}

  const pages: FilepathList = {}

  for (const entry of declared) {
    const resources =
      typeof entry === 'string'
        ? [entry]
        : Array.isArray(entry?.resources)
          ? entry.resources
          : []

    for (const resource of resources) {
      if (typeof resource !== 'string' || !/\.html$/i.test(resource)) continue

      const page = declaredResourceSource(manifestPath, projectPath, resource)
      if (!page) continue

      pages[page.output.replace(/\.html$/i, '')] = page.source
    }
  }

  return pages
}
