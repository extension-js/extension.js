import {describe, it, expect, vi, beforeEach} from 'vitest'
import {Compiler} from '@rspack/core'

// Mocks
vi.mock('../../../start-server', () => ({
  startServer: vi.fn(async () => ({
    on: vi.fn(),
    close: vi.fn(),
    clients: new Set()
  }))
}))
vi.mock(
  '../../../steps/create-web-socket-server/web-socket-server/message-dispatcher',
  () => ({
    messageDispatcher: vi.fn()
  })
)
vi.mock('../../../reload-lib/messages', () => ({
  webSocketServerInitialized: () => 'initialized',
  webSocketServerPluginApplyFailed: (m: string) => m,
  webSocketServerNotReady: () => 'not ready',
  fileUpdated: (p: string) => `updated ${p}`
}))

import CreateWebSocketServer from '../../../steps/create-web-socket-server'
import {startServer} from '../../../start-server'
import {messageDispatcher} from '../../../steps/create-web-socket-server/web-socket-server/message-dispatcher'

function makeCompiler(): Compiler {
  const hooks: any = {
    watchRun: {tapAsync: vi.fn((name, fn) => (hooks.__run = fn))}
  }
  const compiler: any = {
    options: {mode: 'development', output: {path: '/tmp/out'}},
    hooks
  }
  return compiler as Compiler
}

describe('CreateWebSocketServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes the server once', async () => {
    const step = new (CreateWebSocketServer as any)({
      manifestPath: '/a/manifest.json',
      browser: 'chrome',
      port: 0
    })
    const compiler = makeCompiler()
    await step.initializeServer(compiler)
    expect(startServer).toHaveBeenCalledTimes(1)
    await step.initializeServer(compiler)
    expect(startServer).toHaveBeenCalledTimes(1)
  })

  it('dispatches message on file change', async () => {
    const step = new (CreateWebSocketServer as any)({
      manifestPath: '/a/manifest.json',
      browser: 'chrome',
      port: 0
    })
    const compiler = makeCompiler()
    await step.initializeServer(compiler)
    step.apply(compiler as any)
    // simulate watchRun
    const files = new Set<string>(['/a/background/service_worker.js'])
    const ctx: any = {modifiedFiles: files}
    await new Promise<void>((resolve) =>
      (compiler as any).hooks.__run(ctx, () => resolve())
    )
    expect(messageDispatcher).toHaveBeenCalled()
  })
})
