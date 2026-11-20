import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compiler, rspack, type Stats} from '@rspack/core'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {sessionOf} from '../../__spec__/helpers/dev-session'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {skipWithoutDevelopDist} from '../../dev-server/__spec__/helpers/develop-dist'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'

const tempFolder = trackTempFolders()

// Files the author ships as they are, in folders named like a compiled entry.
const COPIED = [
  'vendor/background/index.js',
  'vendor/background/service_worker.js',
  'vendor/action/index.js',
  'vendor/options/index.js',
  'vendor/content_scripts/widget.js',
  'vendor/chrome_url_overrides/newtab.js'
]

const AUTHORED = "console.log('shipped as authored')\n"

function scaffold() {
  const root = tempFolder('extjs-copied-like-entries-')
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'copied-like-entries',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'copied-like-entries',
      version: '0.0.0',
      background: {service_worker: 'background.js'},
      action: {default_popup: 'popup.html'},
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content.js']}
      ]
    }),
    'background.js': "console.log('the real worker')\n",
    'content.js': "console.log('the real content script')\n",
    'popup.html':
      '<!doctype html><html><body><script src="./popup.js"></script></body></html>',
    'popup.js': "console.log('the real popup')\n",
    ...Object.fromEntries(COPIED.map((file) => [`public/${file}`, AUTHORED]))
  }

  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative)

    fs.mkdirSync(path.dirname(absolute), {recursive: true})
    fs.writeFileSync(absolute, content)
  }

  return root
}

async function devCompile(root: string) {
  const distPath = path.join(root, 'dist', 'chrome')
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    // The bridge steps only run for a session that has a control port.
    session: sessionOf({
      instanceId: 'copied-like-entries',
      controlPort: 45123
    }),
    silent: true,
    output: {clean: false, path: distPath}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false

  const compiler: Compiler = rspack(config)
  const stats = await new Promise<Stats>((resolve, reject) => {
    compiler.run((error, result) =>
      error || !result ? reject(error) : resolve(result)
    )
  })

  await new Promise<void>((resolve) => compiler.close(() => resolve()))

  return {
    distPath,
    errors: stats.compilation.errors.map((error) => String(error.message))
  }
}

const read = (distPath: string, file: string) =>
  fs.readFileSync(path.join(distPath, file), 'utf8')

beforeEach((context) => {
  skipWithoutDevelopDist(context)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('a copied file in a folder named like a compiled entry', () => {
  it('ships as authored, without the dev runtime of that entry', async () => {
    const {distPath, errors} = await devCompile(scaffold())

    expect(errors).toEqual([])
    // The real entries carry the dev runtime, so the steps did run.
    expect(read(distPath, 'background/service_worker.js')).toContain(
      '__extjsBridgeProducerInstalled'
    )

    expect(read(distPath, 'action/index.js')).toContain(
      '__extjsBridgeRelayInstalled'
    )

    expect(
      fs
        .readdirSync(path.join(distPath, 'content_scripts'))
        .filter((file) => file.endsWith('.js'))
        .map((file) =>
          read(distPath, `content_scripts/${file}`).includes(
            '__extjsBridgeRelayInstalled'
          )
            ? 'relay'
            : file
        )
    ).toContain('relay')

    expect(COPIED.filter((file) => read(distPath, file) !== AUTHORED)).toEqual(
      []
    )
  }, 120_000)
})
