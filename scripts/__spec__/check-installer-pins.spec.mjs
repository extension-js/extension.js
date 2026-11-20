import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import http from 'node:http'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {after, before, test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {
  checkInstallerPins,
  checkPin,
  PIN_PACKAGES,
  parseArgs,
  readInstallerPins,
  VERSIONS_FILE,
  versionUrl
} from '../check-installer-pins.mjs'

const SCRIPT = fileURLToPath(
  new URL('../check-installer-pins.mjs', import.meta.url)
)
const work = mkdtempSync(path.join(tmpdir(), 'installer-pins-'))

// A stand-in registry on loopback. Each version path answers what the case
// planted for it, and every request is counted by path.
const planted = new Map()
const asked = []
let server
let registry = ''

function plant(name, version, answer) {
  planted.set(`/${name.replaceAll('/', '%2f')}/${version}`, answer)
}

function published(name, version, extra = {}) {
  return {
    status: 200,
    body: {
      name,
      version,
      dist: {tarball: `${registry}/${name}/-/${version}.tgz`},
      ...extra
    }
  }
}

before(async () => {
  server = http.createServer((request, response) => {
    asked.push(`${request.method} ${request.url}`)
    const queue = planted.get(request.url)
    const answer = Array.isArray(queue) ? queue.shift() : queue

    if (!answer) {
      response.writeHead(404, {'content-type': 'application/json'})
      response.end('{"error":"version not found"}')

      return
    }

    response.writeHead(answer.status, {'content-type': 'application/json'})
    response.end(
      typeof answer.body === 'string'
        ? answer.body
        : JSON.stringify(answer.body)
    )
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  registry = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  rmSync(work, {recursive: true, force: true})
})

function reset() {
  planted.clear()
  asked.length = 0
}

function versionsFile(name, source) {
  const file = path.join(work, name)
  writeFileSync(file, source)

  return file
}

const TWO_PINS =
  "export const PUPPETEER_BROWSERS_VERSION = '3.2.2'\n" +
  "export const PLAYWRIGHT_VERSION = '1.63.0'\n"

// The script runs as a child, so the stand-in keeps answering meanwhile.
function runScript(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, ...args],
      {env: {...process.env, GITHUB_ACTIONS: 'true'}},
      (error, stdout, stderr) => {
        resolve({code: error ? error.code : 0, stdout, stderr})
      }
    )
  })
}

test('reads every pin in the repository file, and knows the package of each', () => {
  const pins = readInstallerPins(readFileSync(VERSIONS_FILE, 'utf8'))

  assert.deepEqual(
    pins.map((pin) => pin.constant).sort(),
    Object.keys(PIN_PACKAGES).sort()
  )

  for (const pin of pins) {
    assert.ok(pin.name, pin.constant)
    assert.match(pin.version, /^\d+\.\d+\.\d+$/)
  }
})

test('asks the registry for the version document, the scope slash encoded', () => {
  assert.equal(
    versionUrl('https://r.example/', '@puppeteer/browsers', '3.2.2'),
    'https://r.example/@puppeteer%2fbrowsers/3.2.2'
  )

  assert.equal(
    versionUrl('https://r.example', 'playwright', '1.63.0'),
    'https://r.example/playwright/1.63.0'
  )
})

test('passes when every pin resolves, one request each', async () => {
  reset()
  plant(
    '@puppeteer/browsers',
    '3.2.2',
    published('@puppeteer/browsers', '3.2.2')
  )

  plant('playwright', '1.63.0', published('playwright', '1.63.0'))

  const result = await runScript([
    '--file',
    versionsFile('ok.ts', TWO_PINS),
    '--registry',
    registry
  ])

  assert.equal(result.code, 0, result.stderr)
  assert.match(
    result.stdout,
    /PUPPETEER_BROWSERS_VERSION @puppeteer\/browsers@3\.2\.2 resolves/
  )

  assert.match(result.stdout, /PLAYWRIGHT_VERSION playwright@1\.63\.0 resolves/)
  assert.deepEqual(asked.sort(), [
    'GET /@puppeteer%2fbrowsers/3.2.2',
    'GET /playwright/1.63.0'
  ])
})

test('fails and names the pin the registry does not have', async () => {
  reset()
  plant(
    '@puppeteer/browsers',
    '3.2.2',
    published('@puppeteer/browsers', '3.2.2')
  )

  const result = await runScript([
    '--file',
    versionsFile('missing.ts', TWO_PINS),
    '--registry',
    registry
  ])

  assert.equal(result.code, 1)
  assert.match(
    result.stderr,
    new RegExp(`playwright@1\\.63\\.0 is not on ${registry}`)
  )

  assert.match(result.stdout, /::error::PLAYWRIGHT_VERSION playwright@1\.63\.0/)
  assert.match(result.stderr, /FAILED: 1 of 2 pins don't resolve/)
})

test('fails on a pin it knows no package for, without asking the registry', async () => {
  reset()

  const result = await runScript([
    '--file',
    versionsFile('unknown.ts', "export const SELENIUM_VERSION = '4.0.0'\n"),
    '--registry',
    registry
  ])

  assert.equal(result.code, 1)
  assert.match(result.stderr, /no package is known for SELENIUM_VERSION/)
  assert.deepEqual(asked, [])
})

test('fails on a file with no pins in it', async () => {
  reset()

  const result = await runScript([
    '--file',
    versionsFile('empty.ts', '// nothing pinned\n'),
    '--registry',
    registry
  ])

  assert.equal(result.code, 1)
  assert.match(result.stderr, /no pins found/)
})

test('tries a failing registry once more, then names the status', async () => {
  reset()
  plant('playwright', '1.63.0', [
    {status: 503, body: '{}'},
    published('playwright', '1.63.0')
  ])

  const pin = {
    constant: 'PLAYWRIGHT_VERSION',
    name: 'playwright',
    version: '1.63.0'
  }

  assert.equal((await checkPin(pin, {registry})).ok, true)
  assert.equal(asked.length, 2)

  reset()
  plant('playwright', '1.63.0', [
    {status: 503, body: '{}'},
    {status: 502, body: '{}'}
  ])

  const result = await checkPin(pin, {registry})

  assert.equal(result.ok, false)
  assert.match(result.reason, /after 2 tries: HTTP 502/)
})

test('refuses a document for another version, or one with no tarball', async () => {
  reset()
  plant('playwright', '1.63.0', published('playwright', '1.62.0'))
  plant('@puppeteer/browsers', '3.2.2', {
    status: 200,
    body: {name: '@puppeteer/browsers', version: '3.2.2'}
  })

  const [puppeteer, playwright] = await checkInstallerPins(TWO_PINS, {registry})

  assert.equal(playwright.ok, false)
  assert.match(playwright.reason, /answered version 1\.62\.0/)
  assert.equal(puppeteer.ok, false)
  assert.match(puppeteer.reason, /lists no tarball/)
})

test('passes a deprecated pin and says so', async () => {
  reset()
  plant(
    'playwright',
    '1.63.0',
    published('playwright', '1.63.0', {deprecated: 'use 1.63.1'})
  )

  plant(
    '@puppeteer/browsers',
    '3.2.2',
    published('@puppeteer/browsers', '3.2.2')
  )

  const result = await runScript([
    '--file',
    versionsFile('deprecated.ts', TWO_PINS),
    '--registry',
    registry
  ])

  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /playwright@1\.63\.0 is deprecated: use 1\.63\.1/)
  assert.match(result.stdout, /::warning::PLAYWRIGHT_VERSION/)
})

test('reads the registry from the npm variable, and refuses an unknown flag', () => {
  assert.equal(
    parseArgs([], {npm_config_registry: 'http://127.0.0.1:1'}).registry,
    'http://127.0.0.1:1'
  )

  assert.equal(parseArgs([], {}).registry, 'https://registry.npmjs.org')
  assert.equal(parseArgs([], {}).file, VERSIONS_FILE)
  assert.throws(() => parseArgs(['--fast']), /unknown argument --fast/)
})
