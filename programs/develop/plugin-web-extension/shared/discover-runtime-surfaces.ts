// ██╗    ██╗███████╗██████╗       ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██║    ██║██╔════╝██╔══██╗      ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// ██║ █╗ ██║█████╗  ██████╔╝█████╗█████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ╚███╔███╔╝███████╗██████╔╝      ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import type {FilepathList} from '../../types'
import {extractRuntimeSurfaceLiterals} from '../feature-scripts/steps/trace-runtime-loaded-files'
import {
  rootRelativePages,
  scanPageScripts,
  scanScriptGraph
} from './script-graph'

const MAX_PAGE_HOPS = 4

function seedFiles(list: FilepathList): string[] {
  return Object.values(list).flatMap((value) =>
    Array.isArray(value) ? value : value ? [value] : []
  )
}

function literalsFrom(file: string, projectDir: string): string[] {
  return /\.html?$/i.test(file)
    ? scanPageScripts(file, projectDir, extractRuntimeSurfaceLiterals)
    : scanScriptGraph(file, extractRuntimeSurfaceLiterals)
}

// Pages opened only at runtime (setPopup, sidePanel.setOptions,
// offscreen.createDocument, tabs.create) never appear in the manifest. Found
// from the manifest's own scripts and pages, so they build like declared pages.
export function discoverRuntimeSurfacePages(
  manifestPath: string,
  manifestScripts: FilepathList,
  manifestPages: FilepathList
): FilepathList {
  const projectDir = path.dirname(manifestPath)
  const declared = new Set(seedFiles(manifestPages).map((p) => path.resolve(p)))
  const pages: Record<string, string> = {}
  const visited = new Set<string>()
  let frontier = [...seedFiles(manifestScripts), ...seedFiles(manifestPages)]

  for (let hop = 0; hop < MAX_PAGE_HOPS && frontier.length; hop++) {
    const next: string[] = []

    for (const file of frontier) {
      const abs = path.resolve(file)
      if (visited.has(abs)) continue

      visited.add(abs)

      const found = rootRelativePages(literalsFrom(abs, projectDir), projectDir)

      for (const [key, page] of Object.entries(found)) {
        if (declared.has(path.resolve(page)) || pages[key]) continue

        pages[key] = page
        next.push(page)
      }
    }

    frontier = next
  }

  return pages
}
