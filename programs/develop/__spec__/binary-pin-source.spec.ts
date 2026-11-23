import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {
  type ExtensionProject,
  writeExtensionProject
} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// The server is the one seam, so every layer the pin crosses before the
// launcher reads it is the real one, config file included.
const devServer = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))

vi.mock('../dev-server', () => ({devServer}))

vi.mock('../lib/ensure-develop-artifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ensure-develop-artifacts')>()),
  ensureDevelopArtifacts: vi.fn(async () => {}),
  ensureUserProjectDependencies: vi.fn(async () => {})
}))

import {extensionDev} from '../command-dev'
import {binaryPinSources} from '../lib/binary-pin-source'
import {browserConfigBlockName} from '../lib/config-loader'

const tempFolder = trackTempFolders()

function project(options: ExtensionProject = {}): string {
  return writeExtensionProject(tempFolder('extjs-pin-source-'), options)
}

// A path that names nothing: no launcher runs here, and none could run it.
const TYPED = '/no-such-folder/typed-browser'
const IN_BLOCK = '/no-such-folder/block-browser'
const IN_COMMAND = '/no-such-folder/command-browser'

const launcher = async () => ({
  reload: async () => {},
  enableUnifiedLogging: async () => {},
  close: async () => {}
})

async function launcherOptions(
  root: string,
  options: Record<string, unknown>
): Promise<Record<string, unknown>> {
  await extensionDev(root, {port: 0, launcher, ...options} as never)

  const plugin = (devServer.mock.calls[0]?.[1] as Record<string, unknown>)
    ?.browsersPlugin as {options: {browserOptions: Record<string, unknown>}}

  return plugin.options.browserOptions
}

describe('where a dev session says its browser binary was pinned', () => {
  beforeEach(() => {
    devServer.mockReset()
    devServer.mockImplementation(async () => {})

    for (const stream of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, stream).mockImplementation(() => {})
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('names the browser block of the config file that pinned it', async () => {
    const root = project({
      config: `{browser: {chrome: {chromiumBinary: '${IN_BLOCK}'}}}`
    })

    expect(await launcherOptions(root, {browser: 'chrome'})).toMatchObject({
      chromiumBinary: IN_BLOCK,
      chromiumBinarySource:
        'browser.chrome.chromiumBinary in extension.config.js'
    })
  })

  it('names the command block when it outranks the browser block', async () => {
    const root = project({
      config: `{
  browser: {chrome: {chromiumBinary: '${IN_BLOCK}'}},
  commands: {dev: {chromiumBinary: '${IN_COMMAND}'}}
}`
    })

    expect(await launcherOptions(root, {browser: 'chrome'})).toMatchObject({
      chromiumBinary: IN_COMMAND,
      chromiumBinarySource: 'commands.dev.chromiumBinary in extension.config.js'
    })
  })

  it('names no config key when the flag outranks the file', async () => {
    const root = project({
      config: `{
  browser: {chrome: {chromiumBinary: '${IN_BLOCK}'}},
  commands: {dev: {chromiumBinary: '${IN_COMMAND}'}}
}`
    })
    const options = await launcherOptions(root, {
      browser: 'chrome',
      chromiumBinary: TYPED
    })

    expect(options.chromiumBinary).toBe(TYPED)
    expect(options).not.toHaveProperty('chromiumBinarySource')
  })

  it('names no config key when a variable is all that pins the binary', async () => {
    vi.stubEnv('CHROME_BINARY', TYPED)

    const options = await launcherOptions(project({config: '{}'}), {
      browser: 'chrome'
    })

    expect(options.chromiumBinary).toBeUndefined()
    expect(options).not.toHaveProperty('chromiumBinarySource')
  })

  it('names the key the file spells, the Firefox alias included', async () => {
    const root = project({
      config: `{browser: {firefox: {firefoxBinary: '${IN_BLOCK}'}}}`
    })

    expect(await launcherOptions(root, {browser: 'firefox'})).toMatchObject({
      geckoBinary: IN_BLOCK,
      geckoBinarySource: 'browser.firefox.firefoxBinary in extension.config.js'
    })
  })

  it('leaves a pin of the other engine unread and unnamed', async () => {
    const root = project({
      config: `{commands: {dev: {chromiumBinary: '${IN_COMMAND}'}}}`
    })
    const options = await launcherOptions(root, {browser: 'firefox'})

    // The browser the person named still runs, with no Gecko pin on it.
    expect(options.browser).toBe('firefox')
    expect(options.geckoBinary).toBeUndefined()
    expect(options).not.toHaveProperty('geckoBinarySource')
  })
})

describe('where a preview says its browser binary was pinned', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['the config file', {}, IN_COMMAND, 'commands.preview.chromiumBinary'],
    ['the flag', {chromiumBinary: TYPED}, TYPED, undefined]
  ] as const)(
    'hands the launcher %s as what pinned it',
    async (_place, flags, binary, key) => {
      const root = project({
        manifest: {background: {service_worker: 'background.js'}},
        files: {'background.js': 'console.log("background")\n'},
        config: `{commands: {preview: {chromiumBinary: '${IN_COMMAND}'}}}`
      })

      await buildProject(root)

      const {extensionPreview} = await import('../command-preview')
      let handed: Record<string, unknown> = {}

      for (const stream of ['log', 'warn', 'error'] as const) {
        vi.spyOn(console, stream).mockImplementation(() => {})
      }

      await extensionPreview(
        root,
        {browser: 'chrome', mode: 'production', ...flags},
        async (options) => {
          handed = options as unknown as Record<string, unknown>

          return undefined
        }
      )

      expect(handed.chromiumBinary).toBe(binary)
      expect(handed.chromiumBinarySource).toBe(
        key && `${key} in extension.config.js`
      )
    },
    120_000
  )
})

describe('the config key behind a pinned binary', () => {
  const sources = (
    root: string,
    command: 'dev' | 'start' | 'preview',
    browser: string,
    layers: Parameters<typeof binaryPinSources>[0]['layers']
  ) =>
    binaryPinSources({
      projectDir: root,
      command,
      browser,
      envTarget: {mode: 'production', browser},
      layers
    })

  it('names the block an engine target adopted, not the name that ran', async () => {
    const root = project({
      config: `{browser: {firefox: {geckoBinary: '${IN_BLOCK}'}}}`
    })

    expect(
      await sources(root, 'preview', 'gecko-based', {
        flags: {},
        command: {},
        browser: {geckoBinary: IN_BLOCK}
      })
    ).toEqual({
      geckoBinarySource: 'browser.firefox.geckoBinary in extension.config.js'
    })
  })

  it('names start, the command whose block a start run reads', async () => {
    const root = project({config: '{}'})

    expect(
      await sources(root, 'start', 'chrome', {
        flags: {},
        command: {chromiumBinary: IN_COMMAND},
        browser: {chromiumBinary: IN_BLOCK}
      })
    ).toEqual({
      chromiumBinarySource:
        'commands.start.chromiumBinary in extension.config.js'
    })
  })

  // dev prefers geckoBinary across every layer, preview reads layer by layer.
  it.each([
    ['dev', 'browser.firefox.geckoBinary'],
    ['preview', 'commands.preview.firefoxBinary']
  ] as const)('follows the order %s reads its two Gecko keys in', async (command, key) => {
    const root = project({config: '{browser: {firefox: {}}}'})

    expect(
      await sources(root, command, 'firefox', {
        flags: {},
        command: {firefoxBinary: IN_COMMAND},
        browser: {geckoBinary: IN_BLOCK}
      })
    ).toEqual({geckoBinarySource: `${key} in extension.config.js`})
  })

  it('names nothing for a flag, or for a project with no config file', async () => {
    const withConfig = project({config: '{}'})
    const without = project()

    expect(
      await sources(withConfig, 'dev', 'chrome', {
        flags: {chromiumBinary: TYPED, geckoBinary: TYPED},
        command: {chromiumBinary: IN_COMMAND, geckoBinary: IN_COMMAND},
        browser: {}
      })
    ).toEqual({})

    expect(
      await sources(without, 'dev', 'chrome', {
        flags: {},
        command: {chromiumBinary: IN_COMMAND},
        browser: {}
      })
    ).toEqual({})
  })

  it.each([
    ['chromium-based', {chromium: {}}, 'chromium'],
    ['chromium-based', {'chromium-based': {}, chromium: {}}, 'chromium-based'],
    ['chromium', {'chromium-based': {}}, undefined],
    ['gecko-based', {firefox: {}}, 'firefox'],
    ['firefox', {'gecko-based': {}}, undefined],
    ['safari', {'webkit-based': {}}, undefined],
    ['acme-webkit', {safari: {}}, 'safari'],
    ['brave', {brave: {}, chrome: {}}, 'brave']
  ] as const)('reads %s from the block it always did', (browser, blocks, name) => {
    expect(browserConfigBlockName(blocks, browser as never)).toBe(name)
  })
})
