// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {isGeckoBasedBrowser, isWebkitBasedBrowser} from './constants'
import {linkFreePath} from './real-path'

// Which browser the latest build of this folder targeted, read from the
// summaries kept beside it. A folder no summary names has no answer.
export function recordedBuildBrowser(
  outputPath: string,
  artifactRoots: string[]
): string | undefined {
  const target = linkFreePath(path.resolve(outputPath))
  let found: {browser: string; writtenAt: number} | undefined

  for (const root of new Set(artifactRoots.map((dir) => path.resolve(dir)))) {
    let entries: string[] = []

    try {
      entries = fs.readdirSync(root)
    } catch {
      continue
    }

    for (const entry of entries) {
      const summaryFile = path.join(root, entry, 'build-summary.json')

      try {
        const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'))

        if (typeof summary?.browser !== 'string') continue
        if (typeof summary?.output_path !== 'string') continue

        if (linkFreePath(path.resolve(summary.output_path)) !== target) {
          continue
        }

        const writtenAt = fs.statSync(summaryFile).mtimeMs

        if (!found || writtenAt > found.writtenAt) {
          found = {browser: summary.browser, writtenAt}
        }
      } catch {
        // No summary, or one that cannot be read, names nothing.
      }
    }
  }

  return found?.browser
}

// A build is made for one engine. Forks of that engine load it as it is.
export function sharesBrowserEngine(builtFor: string, asked: string): boolean {
  const engine = (browser: string) =>
    isGeckoBasedBrowser(browser)
      ? 'gecko'
      : isWebkitBasedBrowser(browser)
        ? 'webkit'
        : 'chromium'

  return engine(builtFor) === engine(asked)
}
