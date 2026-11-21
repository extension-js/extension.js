import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {extensionPreview} from '../command-preview'
import {loadProjectConfigDefaults} from '../lib/config-loader'
import {trackTempFolders} from './helpers/temp-folders'

// The config of a previewed project reads the env files of the run: the
// production ones, and the ones named for the browser being previewed.
const tempFolder = trackTempFolders()
const KEY = 'EXTENSION_PUBLIC_PREVIEW_PICK'
let before: string | undefined

beforeEach(() => {
  before = process.env[KEY]
  delete process.env[KEY]
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()

  if (before === undefined) delete process.env[KEY]
  else process.env[KEY] = before
})

// The config names a companion folder after the value it read, and the
// folder is not there, so the warning says which env file reached it.
function builtProject(browser: string, envFiles: Record<string, string>) {
  const root = fs.realpathSync(tempFolder('extjs-preview-env-'))
  const manifest = JSON.stringify({
    manifest_version: 3,
    name: 'preview-env',
    version: '1.0.0'
  })

  fs.mkdirSync(path.join(root, 'dist', browser), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'preview-env', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'manifest.json'), manifest)
  fs.writeFileSync(path.join(root, 'dist', browser, 'manifest.json'), manifest)
  fs.writeFileSync(
    path.join(root, 'extension.config.js'),
    `module.exports = {extensions: {dir: './extensions/' + process.env.${KEY}}}\n`
  )

  for (const [name, value] of Object.entries(envFiles)) {
    fs.writeFileSync(path.join(root, name), `${KEY}=${value}\n`)
  }

  return root
}

describe('the env files a previewed config reads', () => {
  it('reads the file named for the browser over the production one', async () => {
    const root = builtProject('firefox', {
      '.env.development': 'from-development',
      '.env.production': 'from-production',
      '.env.firefox': 'from-firefox',
      '.env.chrome': 'from-chrome'
    })
    const result = await extensionPreview(root, {
      browser: 'firefox',
      noBrowser: true
    })

    expect(result?.warnings).toHaveLength(1)
    expect(result?.warnings[0]).toContain('DIR ./extensions/from-firefox')
  })

  it('reads the production file when the config itself picks the browser', async () => {
    const root = builtProject('chromium', {
      '.env.development': 'from-development',
      '.env.production': 'from-production'
    })
    const result = await extensionPreview(root, {noBrowser: true})

    expect(result?.warnings).toHaveLength(1)
    expect(result?.warnings[0]).toContain('DIR ./extensions/from-production')
  })

  // A host can run a dev session of the same project while it previews, and
  // that session reads the config under the development files.
  it('reads the browser layer under production files beside a dev session of the project', async () => {
    const root = builtProject('firefox', {
      '.env.development': 'from-development',
      '.env.production': 'from-production'
    })

    fs.writeFileSync(
      path.join(root, 'extension.config.js'),
      `module.exports = {browser: {firefox: {extensions: {dir: './extensions/' + process.env.${KEY}}}}}\n`
    )

    let previewing = true
    const devSession = (async () => {
      while (previewing) {
        await loadProjectConfigDefaults(root, {
          mode: 'development',
          browser: 'firefox'
        })
      }
    })()
    const result = await extensionPreview(root, {
      browser: 'firefox',
      noBrowser: true
    }).finally(() => {
      previewing = false
    })

    await devSession

    expect(result?.warnings).toHaveLength(1)
    expect(result?.warnings[0]).toContain('DIR ./extensions/from-production')
  })
})
