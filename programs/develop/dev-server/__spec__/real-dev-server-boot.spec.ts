import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {rspack} from '@rspack/core'
import {RspackDevServer} from '@rspack/dev-server'
import {afterAll, describe, expect, it} from 'vitest'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'

const roots: string[] = []

function scaffold() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-devserver-boot-'))
  roots.push(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {private: true, name: 'extjs-devserver-boot', version: '0.0.0'},
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'devserver-boot',
        version: '0.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<!doctype html><html><body><script src="./popup.js"></script></body></html>'
  )
  fs.writeFileSync(path.join(root, 'popup.js'), "console.log('boot marker')\n")

  return root
}

async function startServer(root: string) {
  const projectStructure = await getProjectStructure(root)
  const config = webpackConfig(projectStructure, {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: false, path: path.join(root, 'dist', 'chrome')}
  } as any)
  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )
  config.stats = false

  const compiler = rspack(config)
  // Port 0 lets the OS pick, so a busy runner never collides with this spec.
  const server = new RspackDevServer(
    {port: 0, host: '127.0.0.1', hot: true, client: false} as any,
    compiler
  )
  await server.start()

  const address = (server.server as any)?.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {server, port}
}

describe('rspack dev server (real boot)', () => {
  afterAll(() => {
    for (const root of roots) {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('serves the compiled extension over http and shuts down', async () => {
    const {server, port} = await startServer(scaffold())

    try {
      expect(port).toBeGreaterThan(0)

      // The popup entry ships under the manifest surface that declares it.
      const script = await fetch(`http://127.0.0.1:${port}/action/index.js`)
      expect(script.status).toBe(200)
      expect(await script.text()).toContain('boot marker')

      const manifest = await fetch(`http://127.0.0.1:${port}/manifest.json`)
      expect(manifest.status).toBe(200)
      expect(JSON.parse(await manifest.text()).manifest_version).toBe(3)
    } finally {
      await server.stop()
    }
  }, 120_000)
})
