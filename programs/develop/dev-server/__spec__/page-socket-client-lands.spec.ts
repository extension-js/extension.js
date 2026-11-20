import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {rspack} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {resolveStockSocketClientPath} from '../../lib/dev-server-client-import'
import {pageOfSocketRequest} from '../../plugin-reload/html-refresh'
import {SetupPageReload} from '../../plugin-reload/steps/setup-page-reload'
import {htmlPagesExtensionsFor} from '../../plugin-web-extension/shared/html-page-extensions'

// The dev server hands its client a socket class through ProvidePlugin, and
// the build swaps that file for the one that names the page. This compiles
// the stock client the way a dev session does and runs what came out.
const tempFolder = trackTempFolders()
const pageSocketSource = path.resolve(
  __dirname,
  '../../plugin-reload/reload-lib/page-socket-client.ts'
)

// The alias the build really sets, pointed at the source of the same file.
function aliasOfADevBuild(root: string): Record<string, string> {
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>')
  fs.writeFileSync(path.join(root, 'manifest.json'), '{}')

  const compiler = {
    options: {
      mode: 'development',
      entry: {},
      resolve: {alias: {}},
      devServer: {host: '127.0.0.1', port: 8080, hot: 'only'}
    }
  }

  new SetupPageReload({
    manifestPath: path.join(root, 'manifest.json'),
    browser: 'chrome'
  }).apply(compiler as never)

  // The pages plugin tells every extension once it declared its pages.
  for (const extension of htmlPagesExtensionsFor(compiler as never)) {
    extension.pagesDeclared(compiler as never, [])
  }

  const alias = compiler.options.resolve.alias as Record<string, string>

  return Object.fromEntries(
    Object.keys(alias).map((key) => [key, pageSocketSource])
  )
}

async function compileStockClient(root: string): Promise<string> {
  const stock = resolveStockSocketClientPath() as string
  const socketModule = path.join(path.dirname(stock), '..', 'socket.js')
  const entry = path.join(root, 'entry.mjs')

  fs.writeFileSync(
    entry,
    `import socket from ${JSON.stringify(socketModule)}\nglobalThis.__openSocket = socket\n`
  )

  const compiler = rspack({
    mode: 'development',
    devtool: false,
    target: 'web',
    context: root,
    entry,
    output: {path: path.join(root, 'out'), filename: 'client.js'},
    resolve: {alias: aliasOfADevBuild(root), extensions: ['.ts', '.js']},
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'builtin:swc-loader',
          options: {jsc: {parser: {syntax: 'typescript'}}}
        }
      ]
    },
    // The same provider the dev server applies to a compiler it serves.
    plugins: [new rspack.ProvidePlugin({__rspack_dev_server_client__: stock})]
  })

  await new Promise<void>((resolve, reject) => {
    compiler.run((error, stats) => {
      const failure = error || stats?.compilation.errors[0]

      compiler.close(() => (failure ? reject(failure) : resolve()))
    })
  })

  return fs.readFileSync(path.join(root, 'out', 'client.js'), 'utf8')
}

interface FakeSocket {
  url: string
  onerror?: (error: unknown) => void
}

function runInAPage(bundle: string, pathname: string) {
  const sockets: FakeSocket[] = []
  const logged: unknown[][] = []

  class WebSocket {
    url: string

    constructor(url: string) {
      this.url = url
      sockets.push(this)
    }
  }

  const page: Record<string, unknown> = {
    WebSocket,
    location: {pathname},
    console: {
      ...console,
      error: (...parts: unknown[]) => logged.push(parts)
    },
    setTimeout,
    clearTimeout
  }

  page.globalThis = page
  page.self = page
  vm.runInNewContext(bundle, page)
  ;(page.__openSocket as (url: string, handlers: object) => void)(
    'ws://127.0.0.1:8080/ws/session-1',
    {}
  )

  return {sockets, logged}
}

describe('the dev client a session compiles (real rspack)', () => {
  it('opens its socket with the class that names the page', async () => {
    const bundle = await compileStockClient(tempFolder('extjs-page-socket-'))
    const {sockets} = runInAPage(bundle, '/options/my%20page.html')

    expect(sockets).toHaveLength(1)
    expect(pageOfSocketRequest(sockets[0].url)).toBe('options/my page.html')
  }, 60_000)

  it('logs a socket error through the stock client logger', async () => {
    const bundle = await compileStockClient(tempFolder('extjs-page-socket-'))
    const {sockets, logged} = runInAPage(bundle, '/options/index.html')

    expect(sockets[0].onerror).toBeTypeOf('function')

    sockets[0].onerror?.('the socket broke')

    expect(logged.flat().join(' ')).toContain('the socket broke')
  }, 60_000)
})
