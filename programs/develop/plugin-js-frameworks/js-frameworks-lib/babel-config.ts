//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {parseJsonSafe} from '../../lib/parse-json-safe'

// The names Babel itself looks for: the root config, then the file-relative
// ones it reads for files in the root package.
const BABEL_CONFIG_FILES = [
  'babel.config.js',
  'babel.config.cjs',
  'babel.config.mjs',
  'babel.config.json',
  'babel.config.cts',
  'babel.config.mts',
  'babel.config.ts',
  '.babelrc',
  '.babelrc.js',
  '.babelrc.cjs',
  '.babelrc.mjs',
  '.babelrc.json',
  '.babelrc.cts',
  '.babelrc.mts'
]

// The project's Babel config file, or its package.json when that holds a
// `babel` key. Only the project folder is read, the way Babel's root is.
export function findProjectBabelConfig(
  projectPath: string
): string | undefined {
  for (const name of BABEL_CONFIG_FILES) {
    const candidate = path.join(projectPath, name)

    if (fs.statSync(candidate, {throwIfNoEntry: false})?.isFile()) {
      return candidate
    }
  }

  const packageJsonPath = path.join(projectPath, 'package.json')

  try {
    const packageJson = parseJsonSafe<{babel?: unknown} | null>(
      fs.readFileSync(packageJsonPath, 'utf-8')
    )

    if (packageJson?.babel && typeof packageJson.babel === 'object') {
      return packageJsonPath
    }
  } catch {
    // No readable package.json, no config in it
  }

  return undefined
}

export type BabelFileKind = 'tsx' | 'ts' | 'jsx' | 'js'

interface ProjectBabelInput {
  projectPath: string
  kind: BabelFileKind
  jsxInPlainJs: boolean
  legacyDecorators: boolean
}

// Babel only parses what SWC compiles after it, so the project's config
// needs no preset of its own for TypeScript, JSX or decorators.
function babelParserPlugins(input: ProjectBabelInput) {
  const syntax: string[] =
    input.kind === 'tsx'
      ? ['typescript', 'jsx']
      : input.kind === 'ts'
        ? ['typescript']
        : input.kind === 'jsx' || input.jsxInPlainJs
          ? ['jsx']
          : []

  return [
    ...syntax,
    input.legacyDecorators ? 'decorators-legacy' : 'decorators'
  ]
}

// Options for babel-loader that load the project's own config (Babel finds
// it from `cwd`) and leave the code for SWC in the same shape it came in.
export function projectBabelOptions(input: ProjectBabelInput) {
  return {
    cwd: input.projectPath,
    // Babel's automatic compaction of a file over 500KB prints a note on
    // every build. The bundler minifies, so the output keeps its layout.
    compact: false,
    // Every file parses as a module so an import a plugin adds stays one,
    // and sloppy mode keeps a classic content script with octal escapes valid.
    sourceType: 'module' as const,
    parserOpts: {strictMode: false, plugins: babelParserPlugins(input)}
  }
}
