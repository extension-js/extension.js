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

export const FRAMEWORK_PACKAGES = [
  'react',
  'react-dom',
  'preact',
  'vue',
  'svelte',
  'solid-js'
]

/**
 * @param {string} file
 * @returns {Record<string, any> | undefined}
 */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

// The templates install with no lockfile, so a range resolves to whatever the
// registry holds that minute. One line per resolved version names an upstream release.
/**
 * @param {string} templatesDir
 * @returns {string[]}
 */
export function listFrameworkVersions(templatesDir) {
  /** @type {Map<string, string[]>} */
  const templatesByLine = new Map()

  if (!fs.existsSync(templatesDir)) return []

  for (const entry of fs.readdirSync(templatesDir).sort()) {
    const templateDir = path.join(templatesDir, entry)
    const manifest = readJson(path.join(templateDir, 'package.json'))

    if (!manifest) continue

    const declared = {...manifest.devDependencies, ...manifest.dependencies}

    for (const name of FRAMEWORK_PACKAGES) {
      if (typeof declared[name] !== 'string') continue

      const installed = readJson(
        path.join(templateDir, 'node_modules', name, 'package.json')
      )
      const version =
        typeof installed?.version === 'string'
          ? installed.version
          : 'not installed'
      const line = `${name} ${version} (declared ${declared[name]})`

      templatesByLine.set(line, [...(templatesByLine.get(line) || []), entry])
    }
  }

  return [...templatesByLine.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([line, templates]) => `${line}: ${templates.join(', ')}`)
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const templatesDir = process.argv[2] || path.join(root, 'templates')
  const lines = listFrameworkVersions(templatesDir)
  const heading = 'Framework versions the templates resolved'

  console.log(`${heading}:`)

  for (const line of lines) console.log(`  ${line}`)

  if (lines.length === 0) console.log('  none found')

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### ${heading}\n\n${lines.map((line) => `- ${line}`).join('\n') || '- none found'}\n\n`
    )
  }
}
