// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {delimiter, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// `node scripts/<runner>.mjs` runs without pnpm's PATH, so a bare `dotenv`
// resolves to whatever the shell has first (the Python dotenv on a Mac with
// a Python framework) and `turbo` is not found at all. The repo's own bin
// dir goes first, the way `pnpm run` would put it.
export function withRepoBin(env = process.env) {
  const pathKey =
    Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH'
  const bin = join(repoRoot, 'node_modules', '.bin')

  return {...env, [pathKey]: `${bin}${delimiter}${env[pathKey] || ''}`}
}
