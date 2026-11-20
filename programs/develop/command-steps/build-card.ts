// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import {humanLine} from '../dev-server/lifecycle-stream'
import {resolveLocalizedManifestName} from '../lib/localized-manifest-name'
import {browserRowValue, card} from '../lib/messaging'
import {parseJsonSafe} from '../lib/parse-json-safe'
import {collapseHomeDir} from '../lib/paths'

// The card is the session header, printed before the first work line. The
// caller holds its key, which is what keeps `start` from printing it twice.
export function printBuildCard(
  manifestPath: string,
  browser: string,
  distPath: string,
  projectRoot: string,
  writtenDir: string
): void {
  let extensionLabel = ''

  try {
    // The written manifest has its $EXTENSION_PUBLIC_* values filled, so the
    // card names what ships. The source stands in when none was written.
    const written = nodePath.join(writtenDir, 'manifest.json')
    const manifest = parseJsonSafe(
      fs.readFileSync(fs.existsSync(written) ? written : manifestPath, 'utf-8')
    )
    const name = resolveLocalizedManifestName(manifest, [
      writtenDir,
      nodePath.dirname(manifestPath),
      projectRoot
    ])
    const version = String(manifest?.version || '').trim()
    extensionLabel = name && version ? `${name} ${version}` : name
  } catch {
    // Ignore
  }

  const browserLabel = browserRowValue(String(browser || ''))
  const suffix = process.env.EXTENSION_CLI_UPDATE_SUFFIX || ''
  if (suffix) delete process.env.EXTENSION_CLI_UPDATE_SUFFIX

  humanLine(' ')
  humanLine(
    card({
      version:
        process.env.EXTENSION_DEVELOP_VERSION ||
        process.env.EXTENSION_CLI_VERSION,
      suffix,
      rows: [
        {label: 'Browser', value: browserLabel},
        {label: 'Extension', value: extensionLabel},
        {label: 'Output', value: collapseHomeDir(distPath)}
      ]
    })
  )

  humanLine(' ')
  process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'
}
