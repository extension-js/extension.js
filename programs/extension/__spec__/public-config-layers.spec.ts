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
type Commands = NonNullable<InternalFileConfig['commands']>
type InternalBrowser = NonNullable<
  NonNullable<InternalFileConfig['browser']>['chrome']
>
type Gaps<Internal, Public> = Exclude<keyof Internal, keyof Public>
type NoGaps<Internal, Public> = [Gaps<Internal, Public>] extends [never]
  ? true
  : Gaps<Internal, Public>

const browserLayer: NoGaps<InternalBrowser, BrowserConfig> = true
const devLayer: NoGaps<NonNullable<Commands['dev']>, DevCommandConfig> = true
const startLayer: NoGaps<
  NonNullable<Commands['start']>,
  StartCommandConfig
> = true
// Preview builds nothing. The CLI keeps these keys, marked deprecated.
const previewLayer: NoGaps<
  NonNullable<Commands['preview']>,
  PreviewCommandConfig
> = true
const buildLayer: NoGaps<
  NonNullable<Commands['build']>,
  BuildCommandConfig
> = true

describe('public config types, per layer', () => {
  it('names every key the loader reads for a browser and for each command', () => {
    expect([
      browserLayer,
      devLayer,
      startLayer,
      previewLayer,
      buildLayer
    ]).toEqual([true, true, true, true, true])
  })

  it('accepts the Safari identity keys the Safari docs show', () => {
    const config: FileConfig = {
      browser: {
        safari: {
          appName: 'My Extension',
          bundleId: 'com.example.my-extension',
          developmentTeam: 'A1B2C3D4E5',
          appIcon: './assets/app-icon-1024.png'
        }
      },
      commands: {
        dev: {appIcon: './assets/app-icon-1024.png', macOsOnly: false},
        build: {forceRegenerate: true, safariBinary: '/Applications/Safari.app'}
      }
    }

    expect(config.browser?.safari?.appIcon).toBe('./assets/app-icon-1024.png')
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
