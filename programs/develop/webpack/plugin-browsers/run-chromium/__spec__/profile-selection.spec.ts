import {beforeEach, describe, expect, it, vi} from 'vitest'

// Ensure the plugin believes a binary exists during tests
vi.mock('fs', async (orig) => {
  const mod = await (orig as any)()
  return {
    ...mod,
    existsSync: (p: string) => true
  }
})
vi.mock('chrome-location2', () => ({default: () => '/Applications/Chrome.app'}))
vi.mock('edge-location', () => ({default: () => '/Applications/Edge.app'}))

const browserConfigMock = vi.fn(() => ['--flagA'])
vi.mock('../browser-config', () => ({
  browserConfig: (...args: any[]) => browserConfigMock(...args)
}))

// Mock instance manager to simulate a running instance to force per-instance profile
vi.mock('../../browsers-lib/instance-manager', () => {
  return {
    InstanceManager: class {
      constructor(_: any) {}
      async getRunningInstances() {
        return [{status: 'running', browser: 'chrome'}]
      }
      async getInstance() {
        return {
          instanceId: 'abc',
          browser: 'chrome',
          projectPath: process.cwd(),
          port: 8081,
          webSocketPort: 9001,
          managerExtensionId: 'x',
          startTime: Date.now(),
          status: 'running',
          processId: process.pid
        }
      }
      async updateInstance() {}
    }
  }
})

import {RunChromiumPlugin} from '../index'

function mkCompiler() {
  return {
    hooks: {
      done: {
        tapAsync: (_: any, cb: any) =>
          cb(
            {compilation: {options: {output: {path: '/tmp/out/chrome'}}}},
            () => {}
          )
      }
    },
    options: {context: process.cwd()}
  } as any
}

describe('profile selection under concurrency', () => {
  beforeEach(() => {
    browserConfigMock.mockClear()
  })

  it('uses per-instance profile when another chromium instance is running', async () => {
    const plugin = new RunChromiumPlugin({
      extension: ['/path/to/user-ext'],
      browser: 'chrome'
    } as any)
    const compiler = mkCompiler()
    plugin.apply(compiler as any)

    // browserConfig called with profile: undefined (per-instance managed)
    const call = browserConfigMock.mock.calls[0]?.[1] || {}
    expect(call.profile).toBeUndefined()
  })
})
