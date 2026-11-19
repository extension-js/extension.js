import * as fs from 'node:fs'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'

const makeTempFolder = trackTempFolders()

const HOST_ENV = 'EXTENSION_DEV_SERVER_CONNECTABLE_HOST'

// Two sessions of one host process: the second wrote its host last.
const SECOND_SESSION_HOST = 'session-b.example'

beforeEach(() => {
  vi.stubEnv(HOST_ENV, SECOND_SESSION_HOST)
  // A dev session exports its port, which turns the page HMR client on.
  vi.stubEnv('EXTENSION_DEV_SERVER_HOST', '127.0.0.1')
  vi.stubEnv('EXTENSION_DEV_SERVER_PORT', '8131')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function project() {
  const root = fs.realpathSync(makeTempFolder('extjs-session-host-'))

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'session-host', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'session-host',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      content_security_policy: {
        extension_pages: "script-src 'self'; connect-src 'self'"
      }
    })
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<!doctype html><html><body><script src="./popup.js"></script></body></html>\n'
  )

  fs.writeFileSync(path.join(root, 'popup.js'), 'console.log("popup")\n')

  return root
}

interface SessionOutput {
  connectSrc: string
  popup: string
}

// One real development compile of a dev session config, as the dev server
// builds it for a session given this host.
async function compileSession(
  connectableHost: string | undefined
): Promise<SessionOutput> {
  const root = project()
  const distPath = path.join(root, 'dist', 'chrome')
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    connectableHost,
    output: {clean: false, path: distPath}
  } as never)
  config.plugins = (config.plugins || []).filter(
    (plugin) => plugin?.constructor.name !== 'plugin-browsers'
  )

  config.plugins.push(new rspack.HotModuleReplacementPlugin())
  config.stats = false

  const compiler = rspack(config)
  const stats = await new Promise<Stats>((resolve, reject) =>
    compiler.run((error, result) =>
      error || !result ? reject(error) : resolve(result)
    )
  )
  await new Promise((resolve) => compiler.close(resolve))

  expect(stats.compilation.errors.map((error) => error.message)).toEqual([])

  const asset = (name: string) =>
    String(stats.compilation.getAsset(name)?.source.source() ?? '')
  const manifest = JSON.parse(asset('manifest.json'))
  const policy = String(manifest.content_security_policy?.extension_pages)
  const connectSrc =
    policy
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('connect-src')) ?? ''
  const popup = stats.compilation
    .getAssets()
    .filter((entry) => /^action\/.*\.js$/.test(entry.name))
    .map((entry) => String(entry.source.source()))
    .join('\n')

  return {connectSrc, popup}
}

// The host the page HMR client dials, read from its baked query.
function hmrHost(source: string) {
  return /hostname=([^&"'\\]+)/.exec(source)?.[1] ?? null
}

describe('the connectable host a dev session compiles into its pages', () => {
  it('is the one each of two sessions was given, not the environment', async () => {
    const first = await compileSession('session-a.example')
    const second = await compileSession(SECOND_SESSION_HOST)

    expect(first.connectSrc).toContain('ws://session-a.example:*')
    expect(first.connectSrc).toContain('http://session-a.example:*')
    expect(first.connectSrc).not.toContain(SECOND_SESSION_HOST)
    expect(hmrHost(first.popup)).toBe('session-a.example')

    expect(second.connectSrc).toContain(`ws://${SECOND_SESSION_HOST}:*`)
    expect(hmrHost(second.popup)).toBe(SECOND_SESSION_HOST)
  }, 60_000)

  it('is the environment when no session names one', async () => {
    const output = await compileSession(undefined)

    expect(output.connectSrc).toContain(`ws://${SECOND_SESSION_HOST}:*`)
    expect(hmrHost(output.popup)).toBe(SECOND_SESSION_HOST)
  }, 60_000)
})
