import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {devServerRestarting} from '../messages'

const ANSI = /\u001b\[[0-9;]*m/g

describe('the dev restart notice', () => {
  it('shortens the changed, before and after paths the same way', () => {
    const cwd = process.cwd()
    const line = devServerRestarting({
      reason: 'scripts',
      pathChanged: path.join(cwd, 'manifest.json'),
      pathBefore: path.join(cwd, 'content-restart-notice-before.js'),
      pathAfter: path.join(cwd, 'content-restart-notice-after.js')
    }).replace(ANSI, '')

    expect(line).toContain('CHANGED manifest.json')
    expect(line).toContain('BEFORE content-restart-notice-before.js')
    expect(line).toContain('AFTER content-restart-notice-after.js')
    expect(line).not.toContain(cwd)
  })
})
