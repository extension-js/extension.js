// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import path from 'node:path'
import {fileURLToPath} from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

// The source file behind each import of a workspace package. A published
// manifest names built files only, so workspace tools read the map from here.
export const workspaceSourceEntries = {
  'extension-create': 'programs/create/module.ts',
  'extension-develop': 'programs/develop/module.ts',
  'extension-develop/bridge': 'programs/develop/bridge-entry.ts',
  'extension-develop/contracts': 'programs/develop/contracts-entry.ts',
  'extension-develop/preview': 'programs/develop/preview-entry.ts',
  'extension-install': 'programs/install/module.ts'
}

const escapePattern = (/** @type {string} */ value) =>
  value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

// Exact matches only, so a deeper import of the same package is left alone.
export function workspaceSourceAliases(root = repoRoot) {
  return Object.entries(workspaceSourceEntries).map(([specifier, file]) => ({
    find: new RegExp(`^${escapePattern(specifier)}$`),
    replacement: path.join(root, file)
  }))
}
