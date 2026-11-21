import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type DevWatchSession,
  errorsOf,
  openDevWatchSession
} from '../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'

const tempFolder = trackTempFolders()

let root = ''
let session: DevWatchSession
let release: (() => void) | undefined
let slowBuilds = 0

beforeAll(async () => {
  root = tempFolder('extjs-settle-')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'settle', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'settle',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')

  session = await openDevWatchSession(root, 'chrome', (compiler) => {
    // A build the row holds open, the way a slow machine stretches one.
    compiler.hooks.make.tapPromise('spec-slow-build', async () => {
      if (slowBuilds === 0) return

      slowBuilds -= 1
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
  })

  expect(errorsOf(await session.doneAfter(0, 120000))).toEqual([])
}, 300000)

afterAll(async () => {
  release?.()
  await session?.close()
})

describe('a dev watch session that settles', () => {
  it('is not settled while a rebuild is still running', async () => {
    const seen = await session.settle()
    let settled = false

    slowBuilds = 1
    session.compiler.watching?.invalidate()

    // Longer than the quiet a settle asks for, with the build still open.
    await new Promise<void>((resolve) => setTimeout(resolve, 900))
    expect(release).toBeTypeOf('function')

    const settling = session.settle().then((count) => {
      settled = true

      return count
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 200))
    expect(settled).toBe(false)

    release?.()
    release = undefined

    expect(await settling).toBe(seen + 1)
  }, 300000)
})
