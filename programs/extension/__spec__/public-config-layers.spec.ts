import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import type {FileConfig as InternalFileConfig} from '../../develop/types'
import type {
  BrowserConfig,
  BuildCommandConfig,
  DevCommandConfig,
  FileConfig,
  PreviewCommandConfig,
  StartCommandConfig
} from '../config-types'

// The published config type is hand-kept beside the one the loader reads, so
// a key the loader honors but the type omits fails a type-checked config that
// works. Each layer below must name every key its internal twin does; a gap
// makes `pnpm typecheck` fail on the assignment, naming the missing keys.
// The assignments are the whole check: nothing here can fail at run time.
type Commands = NonNullable<InternalFileConfig['commands']>
type InternalBrowser = NonNullable<
  NonNullable<InternalFileConfig['browser']>['chrome']
>
type Gaps<Internal, Public> = Exclude<keyof Internal, keyof Public>
type NoGaps<Internal, Public> = [Gaps<Internal, Public>] extends [never]
  ? true
  : Gaps<Internal, Public>

const everyLayerNamesWhatTheLoaderReads: [
  NoGaps<InternalBrowser, BrowserConfig>,
  NoGaps<NonNullable<Commands['dev']>, DevCommandConfig>,
  NoGaps<NonNullable<Commands['start']>, StartCommandConfig>,
  // Preview builds nothing. The CLI keeps these keys, marked deprecated.
  NoGaps<NonNullable<Commands['preview']>, PreviewCommandConfig>,
  NoGaps<NonNullable<Commands['build']>, BuildCommandConfig>
] = [true, true, true, true, true]

void everyLayerNamesWhatTheLoaderReads

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

  it('takes budgets under start and refuses them under preview', () => {
    const config: FileConfig = {
      commands: {
        start: {
          perfBudgets: {'service-worker': 10},
          noOpen: true,
          startingUrl: 'https://example.com'
        },
        preview: {noOpen: true, startingUrl: 'https://example.com'}
      }
    }
    const refused: FileConfig = {
      // @ts-expect-error preview builds nothing, so no budget applies
      commands: {preview: {perfBudgets: {'service-worker': 10}}}
    }

    expect(config.commands?.start?.perfBudgets).toEqual({'service-worker': 10})
    expect(Object.keys(refused.commands?.preview || {})).toEqual([
      'perfBudgets'
    ])
  })
})
