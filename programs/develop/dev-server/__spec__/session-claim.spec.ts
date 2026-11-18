import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {claimDevSession} from '../session-claim'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

function projectDir(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-claim-'))
  roots.push(root)
  const dir = path.join(root, name)
  fs.mkdirSync(dir)

  return dir
}

describe('the dev session claim of one host', () => {
  it('refuses a second claim of one project and browser until the first is released', () => {
    const dir = projectDir('proj')
    const release = claimDevSession(dir, 'chromium')

    expect(release).toBeTypeOf('function')
    expect(claimDevSession(dir, 'chromium')).toBeNull()

    const firefox = claimDevSession(dir, 'firefox')
    expect(firefox).toBeTypeOf('function')

    release?.()
    firefox?.()

    const again = claimDevSession(dir, 'chromium')
    expect(again).toBeTypeOf('function')
    again?.()
  })

  it('takes one project named in another case as the same project', (context) => {
    const dir = projectDir('Proj')
    const otherCase = path.join(path.dirname(dir), 'proj')

    // Only a disk that ignores case has the two names reach one folder.
    if (!fs.existsSync(otherCase)) context.skip()

    const release = claimDevSession(dir, 'chromium')

    try {
      expect(claimDevSession(otherCase, 'chromium')).toBeNull()
    } finally {
      release?.()
    }
  })
})
