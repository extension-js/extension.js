import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  CLI_ROOT,
  type CliHome,
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
// What a run prints when the answer comes after its banner, on stderr.
const LATE_NOTICE = 'The latest stable is 99.0.0.'

// The answer races the banner, so a run tells of the update in one of two
// places. Which one is pinned only where the row controls the order.
function tellsOfUpdate(output: string): boolean {
  return output.includes(NOTICE) || output.includes(LATE_NOTICE)
}

const {version} = JSON.parse(
  fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8')
)
const BANNER = ` 🧩 Extension.js ${version}`

// The answers a home's cache folder keeps, one per registry asked.
function cachedAnswers(home: CliHome): string[] {
  const file = path.join(home.cacheHome, 'extensionjs', 'update-check.json')

  return fs.existsSync(file)
    ? Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')))
    : []
}

// dev, start, preview and build ask a registry for the latest version, and the
// suite's network guard patches this process only, so a child needs a pin.
describe('the update check of a spawned CLI', () => {
  let server: http.Server
  let registry = ''
  let projectDir = ''
  const asked: string[] = []

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      asked.push(String(request.url))
      response.writeHead(200, {'content-type': 'application/json'})
      response.end(JSON.stringify({name: 'extension', version: '99.0.0'}))
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
    expect(asked).toEqual(['/extension/latest'])
    expect(tellsOfUpdate(run.output), run.output).toBe(true)
  })

  it('asks the registry npm_config_registry names', async () => {
    asked.length = 0

    const run = await runCli(['build', projectDir], {
      home: freshCliHome(),
      env: {npm_registry: undefined, npm_config_registry: registry}
    })

    expect(run.status, run.output).toBe(0)
    expect(asked).toEqual(['/extension/latest'])
    expect(tellsOfUpdate(run.output), run.output).toBe(true)
  })

  it.each([
    ['under --output json', ['build', '--output', 'json'], {}],
    ['for a command that prints no banner', ['doctor'], {}],
    [
      'with EXTENSION_NO_UPDATE_CHECK=1',
      ['build'],
      {EXTENSION_NO_UPDATE_CHECK: '1'}
    ],
    ['with NO_UPDATE_NOTIFIER=1', ['build'], {NO_UPDATE_NOTIFIER: '1'}],
    ['under CI', ['build'], {CI: 'true'}]
  ])('asks nothing %s', async (_name, args, env) => {
    asked.length = 0

    const [command, ...rest] = args
    const run = await runCli([command, projectDir, ...rest], {
      home: freshCliHome(),
      env: {npm_registry: registry, ...env}
    })

    expect(asked).toEqual([])
    expect(tellsOfUpdate(run.output), run.output).toBe(false)
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
    expect(asked).toEqual(['/extension/latest'])
    expect(tellsOfUpdate(run.output), run.output).toBe(true)
  })

  it('keeps its answer in the home cache, not in a shared temp folder', async () => {
    const home = freshCliHome()
    const tempFolder = cliTempFolder(home)
    const first = await runCli(['build', projectDir], {
      home,
      tempFolder,
      env: {npm_registry: registry}
    })

    expect(first.status, first.output).toBe(0)
    expect(cachedAnswers(home)).toHaveLength(1)
    expect(fs.readdirSync(tempFolder)).not.toContain('update-check')

    asked.length = 0

    // Another home on the same temp folder gets no answer it did not ask for.
    const later = await runCli(['build', projectDir], {
      home: freshCliHome(),
      tempFolder
    })

    expect(later.status, later.output).toBe(0)
    expect(asked).toEqual([])
    expect(later.stderr).toBe('')
    expect(tellsOfUpdate(later.output), later.output).toBe(false)
  })

  // The build is done long before a registry on a real network answers. The
  // answer still has to reach this run and the cache, or no build ever tells.
  it('a build that finishes before the registry answers still prints the notice and keeps the answer', async () => {
    let built = false
    const answers: Array<() => void> = []
    const slow = http.createServer((_request, response) => {
      const answer = () => {
        response.writeHead(200, {'content-type': 'application/json'})
        response.end(JSON.stringify({name: 'extension', version: '99.0.0'}))
      }

      if (built) answer()
      else answers.push(answer)
    })

    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve))

    const address = slow.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const home = freshCliHome()
    const session = startCli(['build', projectDir], {
      home,
      env: {npm_registry: `http://127.0.0.1:${port}/`}
    })

    try {
      await session.waitFor(
        () => session.read().stdout.includes('Extension built for production'),
        60_000,
        'the built line'
      )

      built = true
      for (const answer of answers.splice(0)) answer()

      expect(await session.closed).toEqual({status: 0, signal: null})
      // After the banner, so on stderr and never inside the build's output.
      expect(session.read().stdout).not.toContain(NOTICE)
      expect(session.read().stderr).toContain(LATE_NOTICE)
      expect(cachedAnswers(home)).toHaveLength(1)
    } finally {
      session.killGroup()
      slow.closeAllConnections()
      await new Promise<void>((resolve) => slow.close(() => resolve()))
    }
  })

  it('prints no cached notice to a later run with default options', async () => {
    const home = cliHome()

    asked.length = 0

    const first = await runCli(['build', projectDir], {
      env: {npm_registry: registry}
    })

    // On the banner when the answer came first, on stderr when the banner did.
    expect(first.status, first.output).toBe(0)
    expect(asked).toEqual(['/extension/latest'])
    expect(tellsOfUpdate(first.output), first.output).toBe(true)

    // Read from the cache, the answer is always there before the banner.
    asked.length = 0

    const cached = await runCli(['build', projectDir], {
      env: {npm_registry: registry}
    })

    expect(cached.status, cached.output).toBe(0)
    expect(asked).toEqual([])
    expect(cached.stdout.split('\n')).toContain(`${BANNER} (${NOTICE})`)

    const later = await runCli(['build', projectDir])

    expect(later.status, later.output).toBe(0)
    expect(asked).toEqual([])
    expect(later.stderr).toBe('')
    expect(tellsOfUpdate(later.output), later.output).toBe(false)
    expect(later.stdout.split('\n')).toContain(BANNER)
    // One answer cached, for the registry that gave it.
    expect(cachedAnswers(home)).toHaveLength(1)
  })

  it('a registry that never answers does not keep a finished build running', async () => {
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

      // Twice the check's own bound: the CLI is gone by then.
      const exited = await Promise.race([
        session.closed,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))
      ])

      expect(exited).toEqual({status: 0, signal: null})
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
    expect(tellsOfUpdate(run.output), run.output).toBe(false)
    expect(run.output).not.toContain('update is available')
  })
})
