import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {readyContractPath} from '../lib/session-paths'
import {buildProject} from './helpers/build-project'
import {trackTempFolders} from './helpers/temp-folders'

// A build can fail after its compile passed. The receipt then says failed,
// and the output folder is as the build found it.
const tempFolder = trackTempFolders()

function project(config?: string) {
  const root = fs.realpathSync(tempFolder('extjs-late-failure-'))

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'probe', version: '1.0.0', private: true})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Probe',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log(1)\n')
  if (config) fs.writeFileSync(path.join(root, 'extension.config.js'), config)

  return root
}

const withPlugin = (body: string) =>
  `module.exports = {config: (config) => {
  config.plugins = [...(config.plugins || []), {apply(compiler) {${body}}}]
  return config
}}\n`

const readyOf = (root: string, browser: string) =>
  JSON.parse(fs.readFileSync(readyContractPath(root, browser), 'utf8'))

const failureOf = (build: Promise<unknown>) =>
  build.then(
    () => undefined,
    (error: Error & {code?: string}) => error
  )

afterEach(() => vi.restoreAllMocks())

describe('a Safari build whose packaging step fails', () => {
  it('records the packager failure and never says ready', async () => {
    const root = project()

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const failure = await failureOf(
      buildProject(root, {
        browser: 'safari',
        safariPackager: async () => {
          throw new Error('the app could not be built')
        }
      } as never)
    )
    const ready = readyOf(root, 'safari')

    expect(failure?.message).toContain('the app could not be built')
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('build_failed')
    expect(ready.message).toContain('the app could not be built')
  }, 60_000)

  it('records an output folder that is gone before packaging', async () => {
    const root = project(
      withPlugin(`compiler.hooks.done.tap('gone', () => {
      require('node:fs').rmSync(compiler.options.output.path, {recursive: true, force: true})
    })`)
    )

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const failure = await failureOf(
      buildProject(root, {
        browser: 'safari',
        safariPackager: async () => ({})
      } as never)
    )
    const ready = readyOf(root, 'safari')

    expect(failure?.code).toBe('E_PREVIEW_NO_DIST')
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('build_failed')
  }, 60_000)

  it('says ready once the packager is done', async () => {
    const root = project()
    let statusWhilePackaging = ''

    await buildProject(root, {
      browser: 'safari',
      safariPackager: async () => {
        statusWhilePackaging = readyOf(root, 'safari').status

        return {}
      }
    } as never)

    expect(statusWhilePackaging).toBe('starting')
    expect(readyOf(root, 'safari').status).toBe('ready')
  }, 60_000)
})

describe('a build whose totals cannot be read after the compile', () => {
  it('fails and leaves the previous output folder in place', async () => {
    const root = project()

    await buildProject(root)

    const dist = path.join(root, 'dist', 'chrome')
    const before = fs.readFileSync(
      path.join(dist, 'background', 'service_worker.js'),
      'utf8'
    )

    fs.writeFileSync(path.join(root, 'background.js'), 'console.log(2)\n')
    fs.writeFileSync(
      path.join(root, 'extension.config.js'),
      withPlugin(`compiler.hooks.done.tap('totals', (stats) => {
      stats.toJson = () => { throw new Error('the totals could not be read') }
    })`)
    )

    vi.spyOn(console, 'error').mockImplementation(() => {})

    const failure = await failureOf(buildProject(root))

    expect(failure?.message).toContain('the totals could not be read')
    expect(
      fs.readFileSync(
        path.join(dist, 'background', 'service_worker.js'),
        'utf8'
      )
    ).toBe(before)

    expect(readyOf(root, 'chrome').status).toBe('error')
  }, 60_000)
})
