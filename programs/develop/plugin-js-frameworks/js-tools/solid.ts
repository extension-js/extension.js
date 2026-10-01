//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {isDebug, prefix} from '../../lib/messaging'
import {ensureOptionalContractPackageResolved} from '../../lib/optional-deps-resolver'
import type {JsFramework} from '../../types'
import {hasDependency} from '../frameworks-lib/integrations'
import * as messages from '../js-frameworks-lib/messages'

let userMessageDelivered = false

export function isUsingSolid(projectPath: string) {
  const using = hasDependency(projectPath, 'solid-js')

  if (using && !userMessageDelivered) {
    if (isDebug()) {
      console.log(`${prefix('debug')} ${messages.isUsingIntegration('Solid')}`)
    }

    userMessageDelivered = true
  }

  return using
}

type ResolveFromProject = (id: string) => string | undefined

// An exports entry is either a file or a condition map. Browser and import
// come first because the bundle always runs in a browser as an ES module.
function pickEsmCondition(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry !== 'object') return undefined

  const conditions = entry as Record<string, unknown>

  for (const name of ['browser', 'import', 'module', 'default']) {
    const picked = pickEsmCondition(conditions[name])
    if (picked) return picked
  }

  return undefined
}

// require.resolve answers under the require condition, so solid-js/h comes
// back as the CommonJS build. That copy pulls a second solid-js instance into
// the bundle and the two reactive graphs never see each other, which reads as
// dead reactivity: a signal write updates nothing in the DOM. Read the
// package's own exports map instead and take the ES module it points at.
export function resolveSolidHyperscript(
  resolveFromProject: ResolveFromProject
): string | undefined {
  const packageJsonPath = resolveFromProject('solid-js/package.json')

  if (packageJsonPath) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      const subpath = pickEsmCondition(packageJson?.exports?.['./h'])

      if (subpath) {
        const esmPath = path.resolve(path.dirname(packageJsonPath), subpath)
        if (fs.existsSync(esmPath)) return esmPath
      }
    } catch {
      // Ignore
    }
  }

  // Older layouts without an exports map keep the same file name, and the
  // CommonJS build is still better than no hyperscript entry at all.
  return (
    resolveFromProject('solid-js/h/dist/h.js') ||
    resolveFromProject('solid-js/h')
  )
}

// The preset list vite-plugin-solid uses: Babel runs presets last first, so
// TypeScript syntax is gone by the time Solid's compiler reads the JSX.
export function solidBabelOptions(input: {
  solidPreset: string
  typescriptPreset: string
  typescript: boolean
  development: boolean
}) {
  return {
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    // Every file parses as a module so Solid's compiler emits imports, which
    // keeps a classic content script with octal escapes parseable too.
    sourceType: 'module' as const,
    parserOpts: {strictMode: false},
    presets: [
      [input.solidPreset, {development: input.development}],
      ...(input.typescript
        ? [
            [
              input.typescriptPreset,
              {isTSX: true, allExtensions: true, onlyRemoveTypeImports: true}
            ]
          ]
        : [])
    ]
  }
}

// A Solid app is compiled by Solid's own compiler, through Babel, the way
// vite-plugin-solid does it: every script extension, since swc accepts JSX in
// a plain .js file and would otherwise hand it to the automatic runtime. The
// hyperscript alias stays for JSX that reaches that runtime some other way,
// like a precompiled dependency.
export async function maybeUseSolid(
  projectPath: string,
  mode: 'development' | 'production' | string = 'development'
): Promise<JsFramework | undefined> {
  if (!isUsingSolid(projectPath)) return undefined

  const requireFromProject = createRequire(
    path.join(projectPath, 'package.json')
  )

  const resolveFromProject = (id: string) => {
    try {
      return requireFromProject.resolve(id)
    } catch {
      return undefined
    }
  }

  const resolveContractPackage = (dependencyId: string) =>
    ensureOptionalContractPackageResolved({
      contractId: 'solid',
      projectPath,
      dependencyId
    })

  const babelLoader = await resolveContractPackage('babel-loader')
  const solidPreset = await resolveContractPackage('babel-preset-solid')
  const typescriptPreset = await resolveContractPackage(
    '@babel/preset-typescript'
  )

  const adapter = resolveDevelopDistFile('solid-jsx-runtime')
  const hyperscript = resolveSolidHyperscript(resolveFromProject)

  const alias: Record<string, string> = {
    'solid-js/jsx-runtime$': adapter,
    'solid-js/jsx-dev-runtime$': adapter
  }
  if (hyperscript) alias['solid-js/h$'] = hyperscript

  const development = mode === 'development'

  const loaders: JsFramework['loaders'] = [
    {
      test: /\.(js|mjs|cjs|jsx|mjsx)$/,
      exclude: /node_modules/,
      loader: babelLoader,
      options: solidBabelOptions({
        solidPreset,
        typescriptPreset,
        typescript: false,
        development
      })
    },
    {
      test: /\.(ts|mts|cts|tsx|mtsx)$/,
      exclude: /node_modules/,
      loader: babelLoader,
      options: solidBabelOptions({
        solidPreset,
        typescriptPreset,
        typescript: true,
        development
      })
    }
  ]

  return {
    plugins: [],
    loaders,
    alias
  }
}
