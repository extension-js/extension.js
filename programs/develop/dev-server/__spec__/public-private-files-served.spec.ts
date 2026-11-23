import fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {defined} from '../../__spec__/helpers/defined'
import {
  bootLoopback,
  createFixture,
  type LoopbackSession
} from './helpers/loopback-dev-server'
import {settleFixture} from './helpers/settled-fixture'

// The stock dev server serves public/ by URL. A name the build leaves out of
// the output must not be reachable that way either. Markers are fake.
const MARKER = 'FAKE-MARKER-NOT-A-SECRET'

function get(port: number, urlPath: string) {
  return new Promise<{status: number; body: string}>((resolve, reject) => {
    const req = http.request(
      {host: '127.0.0.1', port, path: urlPath, method: 'GET', agent: false},
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })

        res.once('end', () => resolve({status: res.statusCode ?? 0, body}))
      }
    )
    req.once('error', reject)
    req.end()
  })
}

const PRIVATE_FILES = [
  '.env',
  'cfg/.env.local',
  '.npmrc',
  '.DS_Store',
  '.git/config',
  'Thumbs.db',
  'docs/desktop.ini',
  'notes.txt~',
  'Desktop.INI'
]

let root = ''
let session: LoopbackSession | undefined

beforeAll(async () => {
  root = createFixture('extjs-public-private-')
  const publicDir = path.join(root, 'public')

  for (const file of PRIVATE_FILES) {
    const full = path.join(publicDir, file)
    fs.mkdirSync(path.dirname(full), {recursive: true})
    fs.writeFileSync(full, `${MARKER} ${file}\n`)
  }

  await settleFixture(root)
  session = await bootLoopback({root})
  await session.firstCompile
}, 30000)

afterAll(async () => {
  await session?.server.stop()
  if (root) fs.rmSync(root, {recursive: true, force: true})
})

describe('public/ served by the dev server', () => {
  it.each(PRIVATE_FILES)('answers 404 for %s', async (file) => {
    const answer = await get(
      defined(session, 'the booted dev session').port,
      `/${file}`
    )

    expect(answer.status).toBe(404)
    expect(answer.body).not.toContain(MARKER)
  })

  it.each([
    '/%2Eenv',
    '/cfg/%2eenv.local',
    '/Thumbs%2Edb',
    '/docs/../Thumbs.db',
    '/docs%2F..%2FThumbs.db'
  ])('answers 404 for the spelling %s', async (urlPath) => {
    const answer = await get(
      defined(session, 'the booted dev session').port,
      urlPath
    )

    expect(answer.status).toBe(404)
    expect(answer.body).not.toContain(MARKER)
  })

  it('still serves an ordinary public file', async () => {
    const answer = await get(
      defined(session, 'the booted dev session').port,
      '/data.txt'
    )

    expect(answer.status).toBe(200)
    expect(answer.body).toBe('one\n')
  })
})
