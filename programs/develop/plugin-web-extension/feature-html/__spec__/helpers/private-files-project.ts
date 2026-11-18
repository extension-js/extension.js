import * as path from 'node:path'
import {listOutput} from '../../../../plugin-special-folders/__spec__/helpers/compile-harness'
import {
  MARKER,
  notFoundPaths,
  project
} from '../../../../plugin-special-folders/__spec__/helpers/private-files-project'

export {
  build,
  canLink,
  expectNothingPrivate,
  linkPackages,
  MARKER,
  manifest,
  missingRefs,
  notFoundPaths,
  PAGE
} from '../../../../plugin-special-folders/__spec__/helpers/private-files-project'

// The shared fixture project of fake private files, plus dot-named files in
// public/ that a build ships and the files of one installed package.

export const PUBLIC_FILES = {
  'public/.well-known/links.json': '[]',
  'public/.env.example': 'EXAMPLE_KEY=\n',
  'public/logo.png': 'png'
}

// A file of an installed package that the project names ships, and a
// private name inside the package does not.
export const PACKAGE_FILES = {
  'node_modules/pkg/icon.png': 'png-in-package',
  'node_modules/pkg/page.html':
    '<!doctype html><html><head></head><body>own page</body></html>',
  'node_modules/pkg/.env': `PRIVATE_KEY=${MARKER}-package-env\n`
}

export const PUBLIC_OUTPUT = [
  '.env.example',
  '.well-known/links.json',
  'logo.png'
]

// The paths a build names as not found, one list per copy: the terminal
// lines, then the JSON summary that closes what the build printed.
export function notFoundCopies(printed: string) {
  const cut = printed.lastIndexOf('\n{"')

  return {
    terminal: notFoundPaths(printed.slice(0, cut)),
    summary: notFoundPaths(printed.slice(cut))
  }
}

export interface Project {
  root: string
  // A file one folder above the project, which no build should reach.
  outsideFile: string
}

export function makeProject(files: Record<string, string> = {}): Project {
  const root = project({...PUBLIC_FILES, ...PACKAGE_FILES, ...files})

  return {root, outsideFile: path.join(path.dirname(root), 'outside.txt')}
}

// Every file of a built project that holds a text, the page included.
export function outputHolding(
  root: string,
  text: string,
  browser = 'chrome'
): string[] {
  const out = listOutput(path.join(root, 'dist', browser))

  return Object.keys(out)
    .filter((name) => out[name].includes(text))
    .sort()
}
