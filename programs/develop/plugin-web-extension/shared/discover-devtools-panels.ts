// ██╗    ██╗███████╗██████╗       ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██║    ██║██╔════╝██╔══██╗      ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// ██║ █╗ ██║█████╗  ██████╔╝█████╗█████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ╚███╔███╔╝███████╗██████╔╝      ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {filterKeysForThisBrowser} from '../../lib/manifest-utils'
import type {DevOptions, FilepathList} from '../../types'
import {rootRelativePages, scanPageScripts} from './script-graph'

// chrome.devtools.panels.create(title, icon, page, cb): the page argument is
// an extension-root-relative HTML path that never appears in the manifest,
// so entry collection cannot see it there. Literal-string calls are the
// documented shape and are statically findable in the devtools page graph.
const PANELS_CREATE_PATTERN =
  /panels\s*\.\s*create\s*\(\s*(['"`])(?:(?!\1).)*\1\s*,\s*(['"`])(?:(?!\2).)*\2\s*,\s*(['"`])((?:(?!\3).)*)\3/g

function collectPanelLiterals(source: string): string[] {
  const literals: string[] = []

  for (const match of source.matchAll(PANELS_CREATE_PATTERN)) {
    const literal = String(match[4] || '').trim()
    if (literal) literals.push(literal)
  }

  return literals
}

export function discoverDevtoolsPanelPages(
  manifestPath: string,
  browser: DevOptions['browser'] = 'chrome'
): FilepathList {
  const projectDir = path.dirname(manifestPath)

  let devtoolsPage = ''

  try {
    // The fields package resolves firefox:devtools_page and emits the page, so
    // a raw read here would drop the panels of a page the build already ships.
    const manifest = filterKeysForThisBrowser(
      JSON.parse(fs.readFileSync(manifestPath, 'utf-8')),
      browser
    )

    if (typeof manifest?.devtools_page === 'string') {
      devtoolsPage = manifest.devtools_page
    }
  } catch {
    // Ignore
  }

  if (!devtoolsPage) return {}

  const devtoolsHtmlPath = path.join(
    projectDir,
    devtoolsPage.replace(/^\/+/, '')
  )

  return rootRelativePages(
    scanPageScripts(devtoolsHtmlPath, projectDir, collectPanelLiterals),
    projectDir
  )
}
