import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  CLI_ROOT,
  cliHome,
  cliTempFolder,
  DEAD_REGISTRY,
  freshCliHome,
  runCli,
  startCli
} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()
const NOTICE = 'version 99.0.0 is available'
const {version} = JSON.parse(
  fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8')
)
const BANNER = ` 🧩 Extension.js ${version}`

// The cached answers left under a home, one per temp folder a child used.
function cachedAnswers(home: string): string[] {
  return fs
    .readdirSync(home)
    .filter((name) => name.startsWith('tmp-'))
    .map((name) =>
      path.join(home, name, 'update-check', 'extension-latest.json')
    )
    .filter((file) => fs.existsSync(file))
}

// Every CLI start asks a registry for the latest version, and the suite's
// network guard patches this process only, so a child needs a pin of its own.
describe('the update check of a spawned CLI', () => {
  let server: http.Server
  let registry = ''
  let projectDir = ''
  const asked: string[] = []

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      asked.push(String(request.url))
      response.writeHead(200, {'content-type': 'application/json'})
      response.end(JSON.stringify({'dist-tags': {latest: '99.0.0'}}))
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    registry = `http://127.0.0.1:${port}/`
    projectDir = makeTempFolder('extjs-update-check-')
    fs.writeFileSync(
      path.join(projectDir, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'Update', version: '1.0.0'})
    )
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('is pinned to a dead loopback registry for the whole suite', () => {
    expect(process.env.npm_registry).toBe(DEAD_REGISTRY)
  })

  it('asks the registry npm_registry names and prints the notice', async () => {
    const run = await runCli(['build', projectDir], {
      home: freshCliHome(),
      env: {npm_registry: registry}
    })

    expect(run.status, run.output).toBe(0)
    expect(asked).toEqual(['/extension'])
    expect(run.output).toContain(NOTICE)
  })

  it('asks the registry the home .npmrc names when no pin is set', async () => {
    const home = freshCliHome()

    fs.writeFileSync(path.join(home.home, '.npmrc'), `registry=${registry}\n`)
    asked.length = 0

    const run = await runCli(['build', projectDir], {
      home,
      env: {npm_registry: undefined}
    })

    expect(run.status, run.output).toBe(0)
    expect(asked).toEqual(['/extension'])
    expect(run.output).toContain(NOTICE)
  })

  // Pins today's behavior. Ledger 1375 N9.
  it('ledger 1375 N9: replays a cached notice to a later run that shares the temp folder', async () => {
    const home = freshCliHome()
    const tempFolder = cliTempFolder(home)
    const cacheFile = path.join(
      tempFolder,
      'update-check',
      'extension-latest.json'
    )
    const first = await runCli(['build', projectDir], {
      home,
      tempFolder,
      env: {npm_registry: registry}
    })

    expect(first.status, first.output).toBe(0)
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))).toEqual({
      latest: '99.0.0',
      lastUpdate: expect.any(Number)
    })

    asked.length = 0

    // The pin points at a dead port, so only the cache can print the notice.
    const later = await runCli(['build', projectDir], {
      home: freshCliHome(),
      tempFolder
    })

    expect(later.status, later.output).toBe(0)
    expect(asked).toEqual([])
    expect(later.stderr).toBe('')
    expect(later.stdout.split('\n')).toContain(`${BANNER} (${NOTICE})`)
  })

  it('prints no cached notice to a later run with default options', async () => {
    const home = cliHome().home

    asked.length = 0

    const first = await runCli(['build', projectDir], {
      env: {npm_registry: registry}
    })

    expect(first.status, first.output).toBe(0)
    expect(asked).toEqual(['/extension'])
    expect(first.stdout.split('\n')).toContain(`${BANNER} (${NOTICE})`)

    asked.length = 0

    const later = await runCli(['build', projectDir])

    expect(later.status, later.output).toBe(0)
    expect(asked).toEqual([])
    expect(later.stderr).toBe('')
    expect(later.output).not.toContain(NOTICE)
    expect(later.stdout.split('\n')).toContain(BANNER)
    // The answer was cached, in the first run's own folder.
    expect(cachedAnswers(home)).toHaveLength(1)
  })

  // Pins today's behavior. Ledger 1375 N10.
  it('ledger 1375 N10: a registry that never answers keeps a finished build running', async () => {
    const silent = http.createServer(() => {})

    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))

    const address = silent.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const session = startCli(['build', projectDir], {
      env: {npm_registry: `http://127.0.0.1:${port}/`}
    })

    try {
      await session.waitFor(
        () => session.read().stdout.includes('Extension built for production'),
        60_000,
        'the built line'
      )

      // Twice the check's own timeout, so a fixed CLI would be gone by now.
      const exited = await Promise.race([
        session.closed.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 4000)
        )
      ])

      expect(exited).toBe(false)
      expect(session.read().stderr).toBe('')
    } finally {
      session.killGroup()
      silent.closeAllConnections()
      await new Promise<void>((resolve) => silent.close(() => resolve()))
    }
  })

  it('asks nothing and prints no notice under the pin', async () => {
    const home = freshCliHome()

    fs.writeFileSync(path.join(home.home, '.npmrc'), `registry=${registry}\n`)
    asked.length = 0

    const run = await runCli(['build', projectDir], {
      home
    })

    expect(run.status, run.output).toBe(0)
    expect(asked).toEqual([])
    expect(run.output).not.toContain(NOTICE)
    expect(run.output).not.toContain('update is available')
  })
})
