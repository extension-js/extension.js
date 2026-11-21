// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {existsSync, readFileSync} from 'node:fs'
import * as path from 'node:path'

export const EXTENSION_ENV_TYPES_PACKAGE = 'extension'

const OWN_CHROME_TYPES = '@types/chrome'

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

// The first node_modules/<name> on the walk up from the project, the folder
// TypeScript and Node would resolve.
function findUp(projectDir, name) {
  let dir = path.resolve(projectDir)

  while (true) {
    const candidate = path.join(dir, 'node_modules', name)
    if (existsSync(candidate)) return candidate

    const parent = path.dirname(dir)
    if (parent === dir) return undefined

    dir = parent
  }
}

// TypeScript 5 and older load every @types package above the project unless
// `types` is set, TypeScript 6 and later load none unless they are referenced.
function typescriptLoadsAllAtTypes(projectDir) {
  const typescriptDir = findUp(projectDir, 'typescript')
  if (!typescriptDir) return false

  const version = readJson(path.join(typescriptDir, 'package.json'))?.version
  const major = Number.parseInt(String(version), 10)

  return Number.isFinite(major) && major < 6
}

// @types/chrome and chrome-types both declare the chrome global, so only one
// may load. A hoisted copy counts only where TypeScript would load it anyway.
export function projectBringsOwnChromeTypes(projectDir) {
  const pkg = readJson(path.join(projectDir, 'package.json'))

  if (
    pkg?.dependencies?.[OWN_CHROME_TYPES] ||
    pkg?.devDependencies?.[OWN_CHROME_TYPES]
  ) {
    return true
  }

  return (
    typescriptLoadsAllAtTypes(projectDir) &&
    Boolean(findUp(projectDir, OWN_CHROME_TYPES))
  )
}

const STYLE_TYPE = 'Readonly<Record<string, string>>'

// The wildcard blocks extension/types/assets.d.ts ships, for a project where
// that package does not resolve. A spec compares the two so they cannot drift.
export const EXTENSION_ENV_WILDCARD_MODULES = Object.freeze([
  {pattern: '*.css', type: STYLE_TYPE},
  {pattern: '*.scss', type: STYLE_TYPE},
  {pattern: '*.sass', type: STYLE_TYPE},
  {pattern: '*.less', type: STYLE_TYPE},
  {pattern: '*.module.css', type: STYLE_TYPE},
  {pattern: '*.module.scss', type: STYLE_TYPE},
  {pattern: '*.module.sass', type: STYLE_TYPE},
  {pattern: '*.module.less', type: STYLE_TYPE},
  {pattern: '*.png', type: 'string'},
  {pattern: '*.jpg', type: 'string'},
  {pattern: '*.jpeg', type: 'string'},
  {pattern: '*.gif', type: 'string'},
  {pattern: '*.webp', type: 'string'},
  {pattern: '*.avif', type: 'string'},
  {pattern: '*.ico', type: 'string'},
  {pattern: '*.bmp', type: 'string'},
  // SVG stays any so SVGR style loaders that return a component do not conflict.
  {pattern: '*.svg', type: 'any'},
  {pattern: '*?raw', type: 'string'},
  {pattern: '*?url', type: 'string'}
])

function renderWildcardModuleDeclarations(
  modules = EXTENSION_ENV_WILDCARD_MODULES
) {
  return modules
    .map(
      ({pattern, type}) =>
        `declare module '${pattern}' {\n  const content: ${type}\n  export default content\n}\n`
    )
    .join('')
}

// `define` keys that are plain identifiers become ambient constants, so a
// misspelled or missing one is a type error instead of a worker that throws
// at start. Dotted keys (`process.env.X`) have no declaration form.
function renderDefineDeclarations(defineTypes = {}) {
  return Object.entries(defineTypes)
    .filter(([name]) => /^[A-Za-z_$][\w$]*$/.test(name))
    .map(([name, type]) => `declare const ${name}: ${type}\n`)
    .join('')
}

// The shipped types declare every asset import once. A project that runs the
// CLI through npx has no copy of them, so the declares are written here then.
export function renderExtensionEnvTypes(
  typePath = EXTENSION_ENV_TYPES_PACKAGE,
  defineTypes = {},
  {inlineAssetTypes = false, ownChromeTypes = false} = {}
) {
  const defineDeclarations = renderDefineDeclarations(defineTypes)
  const assetDeclarations = inlineAssetTypes
    ? `\n// Asset and stylesheet imports: the ${typePath} package does not resolve
// from this project, so the declares it ships are written here instead.
${renderWildcardModuleDeclarations()}`
    : ''

  return `\
// Required Extension.js types for TypeScript projects.
// This file is auto-generated and should not be excluded.
// If you need additional types, consider creating a new *.d.ts file and
// referencing it in the "include" array of your tsconfig.json file.
// See https://www.typescriptlang.org/tsconfig#include for more information.
${
  ownChromeTypes
    ? `/// <reference types="${typePath}/types/legacy" />

// This project installs @types/chrome, so it types the extension APIs.
// Remove that package to get chrome-types and the native browser namespace.
/// <reference types="chrome" />`
    : `/// <reference types="${typePath}/types" />`
}

// Polyfill types for browser.* APIs
/// <reference types="${typePath}/types/polyfill" />
${assetDeclarations}${defineDeclarations ? `\n${defineDeclarations}` : ''}`
}
