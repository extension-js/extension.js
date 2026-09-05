// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// This module is plain JS with a sibling .d.ts because extension-create also
// imports it and its tsconfig rootDir rejects TypeScript sources from here.

// Always use the published package path so the reference resolves the same
// way inside monorepos and in standalone projects.
export const EXTENSION_ENV_TYPES_PACKAGE = 'extension'

const STYLE_TYPE = 'Readonly<Record<string, string>>'

// Keep this list in step with the wildcard blocks in extension/types/index.d.ts.
// The spec for generate-extension-types compares the two so they cannot drift.
export const EXTENSION_ENV_WILDCARD_MODULES = Object.freeze([
  {pattern: '*.css', type: STYLE_TYPE},
  {pattern: '*.module.css', type: STYLE_TYPE},
  {pattern: '*.module.scss', type: STYLE_TYPE},
  {pattern: '*.module.sass', type: STYLE_TYPE},
  {pattern: '*.png', type: 'string'},
  {pattern: '*.jpg', type: 'string'},
  {pattern: '*.jpeg', type: 'string'},
  {pattern: '*.gif', type: 'string'},
  {pattern: '*.webp', type: 'string'},
  {pattern: '*.avif', type: 'string'},
  {pattern: '*.ico', type: 'string'},
  {pattern: '*.bmp', type: 'string'},
  // SVG stays any so SVGR style loaders that return a component do not conflict.
  {pattern: '*.svg', type: 'any'}
])

export function renderWildcardModuleDeclarations(
  modules = EXTENSION_ENV_WILDCARD_MODULES
) {
  return modules
    .map(
      ({pattern, type}) =>
        `declare module '${pattern}' {\n  const content: ${type}\n  export default content\n}\n`
    )
    .join('')
}

export function renderExtensionEnvTypes(
  typePath = EXTENSION_ENV_TYPES_PACKAGE
) {
  return `\
// Required Extension.js types for TypeScript projects.
// This file is auto-generated and should not be excluded.
// If you need additional types, consider creating a new *.d.ts file and
// referencing it in the "include" array of your tsconfig.json file.
// See https://www.typescriptlang.org/tsconfig#include for more information.
/// <reference types="${typePath}/types" />

// Polyfill types for browser.* APIs
/// <reference types="${typePath}/types/polyfill" />

// Asset and stylesheet imports. These wildcard declarations also live in
// ${typePath}/types, but TypeScript 7 native does not apply them through the
// reference above, so they are emitted here as well.
${renderWildcardModuleDeclarations()}`
}
