// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {findPublicFile} from '../../lib/special-folders/resolve-public-folder'

export const isRemoteUrl = (entry: string) =>
  /^([a-z][a-z0-9+.-]*:)?\/\//i.test(entry)

// The one answer to where a manifest entry is read from, for the check that
// it exists and for the bundler entry alike, so the two cannot disagree.
// The entry is a manifest fields path: absolute, or relative to the manifest.
export function resolveScriptEntryPath(
  entry: string,
  manifestDir: string,
  projectPath: string
) {
  if (!entry || isRemoteUrl(entry)) return entry

  const source = path.isAbsolute(entry) ? entry : path.join(manifestDir, entry)

  if (fs.existsSync(source)) return source

  // public/ ships at the extension root, so a file it holds answers a path
  // that names no source file. The path looked at stays the source one.
  const fromRoot = path.relative(manifestDir, source)

  if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    return source
  }

  return (
    findPublicFile(
      path.join(manifestDir, 'manifest.json'),
      projectPath,
      fromRoot.split(path.sep).join('/')
    ) || source
  )
}
