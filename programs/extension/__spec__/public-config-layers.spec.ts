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
  SafariOptions,
  SpecialFoldersConfig as InternalSpecialFoldersConfig
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
  SafariConfig,
  ServeCommandConfig,
  SpecialFoldersConfig
} from '../config-types'

// The published config type is hand-kept beside the one the loader reads, so
// the two are compared here key by key, in both directions. A difference
// makes `pnpm typecheck` fail on the assignment below and names the keys.
// The assignments are the whole check: nothing here can fail at run time.
type Commands = NonNullable<InternalFileConfig['commands']>
type InternalBrowser = NonNullable<
  NonNullable<InternalFileConfig['browser']>['chrome']
>
type InternalSafari = Omit<SafariOptions, keyof BrowserOptionsBase>

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Extra<A, B> = Exclude<keyof A, keyof B>
// Shared keys whose type or optionality is not the same on both sides.
type Differing<A, B> = {
  [K in keyof A & keyof B]-?: Same<Pick<A, K>, Pick<B, K>> extends true
    ? never
    : K
}[keyof A & keyof B]

// True when both sides agree, apart from the keys named as known exceptions.
// An exception that stops being one fails too, so the list cannot go stale.
type Agrees<
  Public,
  Internal,
  PublicOnly extends PropertyKey = never,
  Differs extends PropertyKey = never
> = [
  Same<Extra<Internal, Public>, never>,
  Same<Extra<Public, Internal>, PublicOnly>,
  Same<Differing<Public, Internal>, Differs>
] extends [true, true, true]
  ? true
  : {
      internalOnly: Extra<Internal, Public>
      publicOnly: Extra<Public, Internal>
      differing: Differing<Public, Internal>
    }

const everyLayerAgreesWithTheLoader: [
  // The engine reads these three from a browser block and its type omits
  // them. It also asks for `browser` inside a block the key already names.
  Agrees<
    BrowserConfig,
    InternalBrowser,
    'transpilePackages' | 'define' | 'perfBudgets',
    'browser'
  >,
  Agrees<DevCommandConfig, NonNullable<Commands['dev']>>,
  Agrees<ServeCommandConfig, NonNullable<Commands['start']>>,
  // Preview builds nothing, so these three keys of the shared type do nothing.
  Agrees<
    ServeCommandConfig,
    NonNullable<Commands['preview']>,
    'polyfill' | 'include' | 'exclude'
  >,
  Agrees<BuildCommandConfig, NonNullable<Commands['build']>>,
  // `browser` differs only through the browser block compared above.
  Agrees<FileConfig, InternalFileConfig, never, 'browser'>,
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
