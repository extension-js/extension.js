import {beforeEach, describe, expect, it, vi} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'

import {DynamicExtensionManager} from '../../browsers-lib/dynamic-extension-manager'

const tmpRoot = path.join(process.cwd(), '.tmp-tests', 'dyn-mgr')

function makeInstance(overrides: Partial<any> = {}) {
  return {
    instanceId: 'abc123456789abcd',
    browser: 'chrome',
    port: 8081,
    webSocketPort: 9001,
    managerExtensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    projectPath: tmpRoot,
    processId: process.pid,
    startTime: Date.now(),
    status: 'running',
    ...overrides
  }
}

describe('DynamicExtensionManager regenerateExtensionIfNeeded', () => {
  beforeEach(() => {
    fs.rmSync(tmpRoot, {recursive: true, force: true})
    fs.mkdirSync(path.join(tmpRoot, 'dist', 'extension-js', 'extensions'), {
      recursive: true
    })
  })

  it('updates reload-service.js in place when only port/instanceId change', async () => {
    const mgr = new DynamicExtensionManager(tmpRoot)
    const inst = makeInstance()
    const gen = await mgr.generateExtension(inst as any)

    const swPath = gen.serviceWorkerPath
    let content = fs.readFileSync(swPath, 'utf-8')
    expect(content).toMatch(/const\s+port\s*=\s*'9001'/)
    expect(content).toMatch(/const\s+instanceId\s*=\s*'abc123456789abcd'/)

    // Change instance details
    const inst2 = makeInstance({
      webSocketPort: 9003,
      instanceId: 'zzzzzzzzzzzzzzzz'
    })
    await mgr.regenerateExtensionIfNeeded(inst2 as any)

    content = fs.readFileSync(swPath, 'utf-8')
    expect(content).toMatch(/const\s+port\s*=\s*'9003'/)
    expect(content).toMatch(/const\s+instanceId\s*=\s*'zzzzzzzzzzzzzzzz'/)
    // Cache buster present
    expect(content).toMatch(/Cache-buster: \d+/)
  })
})
