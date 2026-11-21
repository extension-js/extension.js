import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  idleCompiler,
  tapsAddedBy,
  writeProject
} from '../../__spec__/helpers/real-compiler'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {ReloadPlugin} from '../index'
import {sessionBridge, setSessionBridge} from './helpers/session-bridge'

const makeTempFolder = trackTempFolders()

function thisCompilationTaps(browser: string) {
  const root = writeProject(makeTempFolder('extjs-reload-engine-'), {
    'manifest.json': {
      manifest_version: 3,
      name: 'engine',
      version: '1.0.0',
      background: {service_worker: 'src/background.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['src/content.js']}]
    },
    'src/background.js': '',
    'src/content.js': ''
  })
  const compiler = idleCompiler(root, 'development')
  const taps = tapsAddedBy(compiler, () =>
    new ReloadPlugin({
      session: sessionBridge(),
      manifestPath: path.join(root, 'manifest.json'),
      browser
    } as ConstructorParameters<typeof ReloadPlugin>[0]).apply(compiler)
  )

  return taps.thisCompilation
}

beforeEach(() => {
  setSessionBridge({controlPort: 8123})
  vi.stubEnv('EXTENSION_NO_RELOAD', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ReloadPlugin producer injection per engine', () => {
  it('injects the reload producer and relay for chromium', () => {
    expect(thisCompilationTaps('chromium')).toEqual([
      'StripContentScriptDevServerRuntime',
      'StableContentScriptNames',
      'InjectScriptsReplayShim',
      'SetupDevContentScripts',
      'InjectBridgeProducer',
      'InjectBridgeRelay'
    ])
  })

  it('never injects them into the user background for chromium-emulator', () => {
    expect(thisCompilationTaps('chromium-emulator')).toEqual([
      'StripContentScriptDevServerRuntime',
      'StableContentScriptNames',
      'InjectScriptsReplayShim'
    ])
  })
})
