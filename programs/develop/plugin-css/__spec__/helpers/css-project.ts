import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, type RuleSetRule, rspack} from '@rspack/core'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {realPath} from '../../../lib/css/inline-css-imports'
import {workspaceRootOf} from '../../../lib/public-private-files'
import {CssPlugin} from '../../index'

export type Mode = 'development' | 'production'

// Call once at the top of a spec file, like trackTempFolders.
export function cssProjects() {
  const makeTempFolder = trackTempFolders()

  return (files: Record<string, string>, prefix = 'extjs-css-'): string => {
    // Spelled as the plugin spells paths, or a comparison fails on Windows.
    const root = realPath(makeTempFolder(prefix))
    const all: Record<string, string> = {
      'package.json': JSON.stringify({name: 'css-fixture', version: '0.0.0'}),
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'css-fixture',
        version: '0.0.1'
      }),
      ...files
    }

    for (const [relative, contents] of Object.entries(all)) {
      const file = path.join(root, relative)

      fs.mkdirSync(path.dirname(file), {recursive: true})
      fs.writeFileSync(file, contents)
    }

    return root
  }
}

// A real compiler that writes nowhere but the project's own out/ folder.
export function createCompiler(root: string, mode: Mode): Compiler {
  return rspack({
    context: root,
    mode,
    devtool: false,
    entry: {},
    output: {path: path.join(root, 'out')}
  })
}

export function closeCompiler(compiler: Compiler): Promise<void> {
  return new Promise((resolve) => compiler.close(() => resolve()))
}

// The rules CssPlugin adds, by the path each mode takes: development
// configures in apply, production in the beforeRun hook a build calls.
export async function configureCss(
  root: string,
  mode: Mode,
  browser: 'chrome' | 'firefox' = 'chrome'
): Promise<RuleSetRule[]> {
  const compiler = createCompiler(root, mode)

  try {
    await new CssPlugin({
      manifestPath: path.join(root, 'manifest.json'),
      browser
    }).apply(compiler)

    if (mode === 'production') {
      await compiler.hooks.beforeRun.promise(compiler)
    }

    return compiler.options.module.rules as RuleSetRule[]
  } finally {
    await closeCompiler(compiler)
  }
}

// A fixture with no workspace marker of its own reads the same only when no
// folder above the temp folder declares one, which this checks first.
export function expectNoWorkspaceAbove(projectRoot: string) {
  const root = realPath(projectRoot)

  if (workspaceRootOf(root) !== root) {
    throw new Error(
      `A folder above ${root} declares a workspace, so this fixture would read as part of it. Set TMPDIR to a folder outside any workspace.`
    )
  }
}
