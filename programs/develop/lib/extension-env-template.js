// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export const EXTENSION_ENV_TYPES_PACKAGE = 'extension'

// `define` keys that are plain identifiers become ambient constants, so a
// misspelled or missing one is a type error instead of a worker that throws
// at start. Dotted keys (`process.env.X`) have no declaration form.
export function renderDefineDeclarations(defineTypes = {}) {
  return Object.entries(defineTypes)
    .filter(([name]) => /^[A-Za-z_$][\w$]*$/.test(name))
    .map(([name, type]) => `declare const ${name}: ${type}\n`)
    .join('')
}

export function renderExtensionEnvTypes(
  typePath = EXTENSION_ENV_TYPES_PACKAGE,
  defineTypes = {}
) {
  const defineDeclarations = renderDefineDeclarations(defineTypes)

  return `\
// Required Extension.js types for TypeScript projects.
// This file is auto-generated and should not be excluded.
// If you need additional types, consider creating a new *.d.ts file and
// referencing it in the "include" array of your tsconfig.json file.
// See https://www.typescriptlang.org/tsconfig#include for more information.
/// <reference types="${typePath}/types" />

// Polyfill types for browser.* APIs
/// <reference types="${typePath}/types/polyfill" />
${defineDeclarations ? `\n${defineDeclarations}` : ''}`
}
