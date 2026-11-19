import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import type {PerfBudgetsConfig as InternalPerfBudgetsConfig} from '../../develop/plugin-perf-budgets'
import type {CompanionExtensionsConfig as InternalCompanionExtensionsConfig} from '../../develop/plugin-special-folders/folder-extensions/types'
import type {
  BrowserOptionsBase,
  BrowserType as InternalBrowserType,
  ConfigHookContext as InternalConfigHookContext,
  ExcludeFilesConfig as InternalExcludeFilesConfig,
  FileConfig as InternalFileConfig,
  IncludeFileEntry as InternalIncludeFileEntry,
  IncludeFilesConfig as InternalIncludeFilesConfig,
  SpecialFoldersConfig as InternalSpecialFoldersConfig,
  SafariOptions
} from '../../develop/types'
import type {
  BrowserConfig,
  BrowserType,
  BuildCommandConfig,
  CompanionExtensionsConfig,
  ConfigHookContext,
  DevCommandConfig,
  ExcludeFilesConfig,
  FileConfig,
  IncludeFileEntry,
  IncludeFilesConfig,
  PerfBudgetsConfig,
  PreviewCommandConfig,
  SafariConfig,
  SpecialFoldersConfig,
  StartCommandConfig
} from '../config-types'
import type {Agrees, Same} from './helpers/type-agreement'

// The published config type is hand-kept beside the one the loader reads, so
// the two are compared here key by key, in both directions. A difference
// makes `pnpm typecheck` fail on the assignment below and names the keys.
// The assignments are the whole check: nothing here can fail at run time.
type Commands = NonNullable<InternalFileConfig['commands']>
type InternalBrowser = NonNullable<
  NonNullable<InternalFileConfig['browser']>['chrome']
>
type InternalSafari = Omit<SafariOptions, keyof BrowserOptionsBase>

const everyLayerAgreesWithTheLoader: [
  Agrees<BrowserConfig, InternalBrowser>,
  Agrees<DevCommandConfig, NonNullable<Commands['dev']>>,
  Agrees<StartCommandConfig, NonNullable<Commands['start']>>,
  Agrees<PreviewCommandConfig, NonNullable<Commands['preview']>>,
  Agrees<BuildCommandConfig, NonNullable<Commands['build']>>,
  Agrees<FileConfig, InternalFileConfig>,
  Agrees<SafariConfig, InternalSafari>,
  Agrees<SpecialFoldersConfig, InternalSpecialFoldersConfig>,
  Agrees<IncludeFileEntry, InternalIncludeFileEntry>,
  Agrees<PerfBudgetsConfig, InternalPerfBudgetsConfig>,
  Agrees<ConfigHookContext, InternalConfigHookContext>,
  Same<BrowserType, InternalBrowserType>,
  Same<CompanionExtensionsConfig, InternalCompanionExtensionsConfig>,
  Same<IncludeFilesConfig, InternalIncludeFilesConfig>,
  Same<ExcludeFilesConfig, InternalExcludeFilesConfig>
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true
]

void everyLayerAgreesWithTheLoader

// Budgets belong to the start layer, and preview builds nothing, so it takes
// none. The compiler is what checks both values.
const startTakesBudgets: FileConfig = {
  commands: {
    start: {
      perfBudgets: {'service-worker': 10},
      noOpen: true,
      startingUrl: 'https://example.com'
    },
    preview: {noOpen: true, startingUrl: 'https://example.com'}
  }
}
const previewRefusesBudgets: FileConfig = {
  // @ts-expect-error preview builds nothing, so no budget applies
  commands: {preview: {perfBudgets: {'service-worker': 10}}}
}

// Preview serves an existing build, so the keys that shape one are refused.
const previewRefusesPolyfill: FileConfig = {
  // @ts-expect-error preview builds nothing, so no polyfill applies
  commands: {preview: {polyfill: true}}
}
const previewRefusesInclude: FileConfig = {
  // @ts-expect-error preview builds nothing, so no file is added
  commands: {preview: {include: {'notes.txt': 'notes.txt'}}}
}
const previewRefusesExclude: FileConfig = {
  // @ts-expect-error preview builds nothing, so no file is left out
  commands: {preview: {exclude: ['notes.txt']}}
}

void startTakesBudgets
void previewRefusesBudgets
void previewRefusesPolyfill
void previewRefusesInclude
void previewRefusesExclude

const pkgRoot = path.resolve(__dirname, '..')
const pkg = JSON.parse(
  fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')
)

describe('public config types, per layer', () => {
  it('accepts the Safari identity keys the Safari docs show', () => {
    const safari = {
      appName: 'My Extension',
      bundleId: 'com.example.my-extension',
      developmentTeam: 'A1B2C3D4E5',
      appIcon: './assets/app-icon-1024.png'
    }
    const dev = {appIcon: './assets/app-icon-1024.png', macOsOnly: false}
    const build = {
      forceRegenerate: true,
      safariBinary: '/Applications/Safari.app'
    }

    // Compiled by the typecheck gate: every key the docs show stays assignable.
    const config: FileConfig = {browser: {safari}, commands: {dev, build}}

    // The emitted declaration is what a project annotating its config reads.
    const dts = fs.readFileSync(
      path.join(pkgRoot, path.dirname(pkg.types), 'config-types.d.ts'),
      'utf8'
    )
    const start = dts.indexOf('export interface SafariConfig {')
    const shared = dts.slice(start, dts.indexOf('\n}', start))
    const documented = [
      ...Object.keys(config.browser?.safari ?? {}),
      ...Object.keys(config.commands?.dev ?? {}),
      ...Object.keys(config.commands?.build ?? {})
    ]

    expect(start).toBeGreaterThan(-1)
    expect(
      documented.filter((key) => !shared.includes(`\n    ${key}?: `))
    ).toEqual([])

    for (const layer of [
      'BrowserConfig',
      'DevCommandConfig',
      'BuildCommandConfig'
    ]) {
      expect(dts).toMatch(
        new RegExp(`export interface ${layer} extends [^{]*\\bSafariConfig\\b`)
      )
    }
  })
})
