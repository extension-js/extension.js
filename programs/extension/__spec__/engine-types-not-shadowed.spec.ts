import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
// @ts-expect-error plain ESM script without types, shared with the script specs
import {workspaceSourceEntries} from '../../../scripts/lib/workspace-source-entries.mjs'

type DevelopModule = typeof import('extension-develop')
type DevelopPreviewModule = typeof import('extension-develop/preview')

// An ambient `declare module` wins over the package it names, so one for a
// sibling package would swap its real types for whatever the declaration says.

const extensionRoot = path.resolve(__dirname, '..')
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist'])

function declarationFiles(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return SKIPPED_FOLDERS.has(entry.name) ? [] : declarationFiles(full)
    }

    return entry.name.endsWith('.d.ts') ? [full] : []
  })
}

function shadowedEngineModules(text: string): string[] {
  return [
    ...text.matchAll(
      /declare\s+module\s+['"`](extension-(?:develop|create|install)(?:\/[^'"`]*)?)['"`]/g
    )
  ].map((match) => match[1])
}

describe('the types the CLI reads for the build engine', () => {
  it('finds a declaration of a sibling package and of any of its subpaths', () => {
    expect(
      shadowedEngineModules(
        "declare module 'extension-develop' {}\n" +
          'declare  module "extension-develop/preview" {}\n' +
          "declare module 'extension-create' {}\n" +
          "declare module 'extension-install' {}\n" +
          "declare module 'extension-other' {}\n"
      )
    ).toEqual([
      'extension-develop',
      'extension-develop/preview',
      'extension-create',
      'extension-install'
    ])
  })

  it('are never declared by hand in a .d.ts of this package', () => {
    const files = declarationFiles(extensionRoot)
    const shadowed = files.flatMap((file) =>
      shadowedEngineModules(fs.readFileSync(file, 'utf8')).map(
        (name) => `${path.relative(extensionRoot, file)} declares ${name}`
      )
    )

    expect(files.length).toBeGreaterThan(0)
    expect(
      shadowed,
      'An ambient declaration replaces the types the package exports, ' +
        'so the calls into it stop being checked. Import the real types.'
    ).toEqual([])
  })

  it('come from the sibling sources in the declaration build of this package', () => {
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(extensionRoot, 'tsconfig.json'), 'utf8')
    )

    // Without these the declaration build reads the dist of a sibling, which a
    // fresh clone that compiles this package alone does not have.
    const engineEntries = Object.entries(
      workspaceSourceEntries as Record<string, string>
    )
    // Through the linked package, so the sibling files count as a library and
    // the declarations of this package keep `import('extension-develop')`.
    const expected = Object.fromEntries(
      engineEntries.map(([specifier, file]) => [
        specifier,
        [`./node_modules/${specifier.split('/')[0]}/${path.basename(file)}`]
      ])
    )

    expect(engineEntries.length).toBeGreaterThan(0)
    expect(tsconfig.compilerOptions.customConditions).toBeUndefined()
    expect(tsconfig.compilerOptions.paths).toEqual(expected)

    for (const [target] of Object.values(expected)) {
      expect(fs.existsSync(path.join(extensionRoot, target)), target).toBe(true)
    }
  })

  it('refuse an option the engine does not declare', () => {
    type BuildOptions = NonNullable<
      Parameters<DevelopModule['extensionBuild']>[1]
    >
    type PreviewOptions = Parameters<
      DevelopPreviewModule['extensionPreview']
    >[1]

    const build: BuildOptions = {
      browser: 'chrome',
      // @ts-expect-error the engine has no such build option, so this must not compile
      notAnEngineOption: true
    }
    const preview: PreviewOptions = {
      browser: 'chrome',
      mode: 'production',
      // @ts-expect-error the engine has no such preview option, so this must not compile
      notAnEngineOption: true
    }

    expect(Object.keys(build)).toContain('browser')
    expect(Object.keys(preview)).toContain('browser')
  })
})
