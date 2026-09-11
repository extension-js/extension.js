// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templatesDir = path.join(root, 'templates')
const required = ['typescript', 'react', 'svelte', 'vue']

const missing =
  !fs.existsSync(templatesDir) ||
  required.some(
    (name) => !fs.existsSync(path.join(templatesDir, name, 'package.json'))
  )

if (missing) {
  // The specs live in the examples repo and land here at run time, so an
  // un-hydrated checkout reported "No tests found" instead of what to do.
  console.error('The end-to-end specs are not in this checkout yet.')
  console.error('Run: bash scripts/hydrate-templates-from-examples.sh')
  process.exit(1)
}
