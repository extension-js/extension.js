import {type ChildProcess, spawn, spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import type {AddressInfo} from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'

// Real browsers, headless, so opt-in: EXTENSION_TEST_REAL_BROWSER=1. The CLI
// is the compiled one, or EXTENSION_LOCAL_CLI_CJS to point at another engine.
const CLI =
  process.env.EXTENSION_LOCAL_CLI_CJS ||
  path.resolve(__dirname, '../../bin/extension.cjs')
const RUNS_REAL =
  Boolean(process.env.EXTENSION_TEST_REAL_BROWSER) &&
  process.platform !== 'win32' &&
  fs.existsSync(CLI)
const REPORT_WAIT_MS = 45_000
const BUDGET_MS = 180_000

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      cleanup()
    } catch {
      // Ignore
    }
  }
})

// The page reports, from a <head> script, what the extension's document_start
// CSS did to it before first paint.
function startPageServer(): Promise<{url: string; reports: string[]}> {
  const reports: string[] = []
  const server = http.createServer((req, res) => {
    if (String(req.url).startsWith('/report?')) {
      reports.push(decodeURIComponent(String(req.url).slice(8)))
      res.end('ok')

      return
    }

    res.setHeader('content-type', 'text/html')
    res.end(
      '<!doctype html><html><head><script>' +
        'fetch("/report?" + encodeURIComponent(getComputedStyle(document.documentElement).filter))' +
        '</script></head><body>first page</body></html>'
    )
  })

  cleanups.push(() => server.close())

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as AddressInfo
      resolve({url: `http://127.0.0.1:${port}/`, reports})
    })
  })
}

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-start-url-real-'))
  cleanups.push(() => fs.rmSync(dir, {recursive: true, force: true}))
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"start-url-real","version":"0.0.1","private":true,"type":"module"}'
  )

  fs.writeFileSync(
    path.join(dir, 'src', 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'start-url-real',
      version: '0.0.1',
      browser_specific_settings: {gecko: {id: 'start-url-real@example.com'}},
      background: {
        'chromium:service_worker': 'background.js',
        'firefox:scripts': ['background.js']
      },
      content_scripts: [
        {matches: ['<all_urls>'], css: ['blur.css'], run_at: 'document_start'}
      ]
    })
  )

  fs.writeFileSync(path.join(dir, 'src', 'blur.css'), ':root{filter:blur(4px)}')
  fs.writeFileSync(path.join(dir, 'src', 'background.js'), 'void 0\n')

  return dir
}

// The child is a real session: the VITEST markers vitest set on this process
// would switch its launchers to their test paths.
const env = {...process.env}

for (const key of Object.keys(env)) {
  if (key.startsWith('VITEST') || key === 'NODE_ENV') {
    Reflect.deleteProperty(env, key)
  }
}

env.EXTENSION_HEADLESS = '1'
env.MOZ_HEADLESS = '1'

// A restart needs the first browser gone: one still running on the profile
// takes the second launch over and the round measures nothing.
function stop(child: ChildProcess, profile: string) {
  child.kill('SIGINT')
  spawnSync('sleep', ['3'])
  child.kill('SIGKILL')
  spawnSync('pkill', ['-f', profile])

  for (let attempt = 0; attempt < 20; attempt++) {
    if (spawnSync('pgrep', ['-f', profile]).status !== 0) return

    spawnSync('sleep', ['0.5'])
  }

  spawnSync('pkill', ['-9', '-f', profile])
}

async function waitFor(reports: string[], count: number) {
  const deadline = Date.now() + REPORT_WAIT_MS

  while (reports.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

describe.skipIf(!RUNS_REAL)('the starting url opens after install', () => {
  for (const browser of ['chrome', 'firefox'] as const) {
    it(
      `${browser}: the first page and a restart get document_start CSS`,
      async () => {
        const project = makeProject()
        const profile = path.join(project, 'profile')
        const page = await startPageServer()
        const build = spawnSync(
          process.execPath,
          [CLI, 'build', '--browser', browser],
          {cwd: project, env, encoding: 'utf-8'}
        )
        expect(build.status).toBe(0)

        for (const round of [1, 2]) {
          const session = spawn(
            process.execPath,
            [
              CLI,
              'start',
              '--browser',
              browser,
              '--profile',
              profile,
              '--starting-url',
              page.url
            ],
            {cwd: project, env, stdio: 'ignore'}
          )
          cleanups.push(() => stop(session, profile))

          await waitFor(page.reports, round)
          // A later load of the same page would show up here too.
          await new Promise((resolve) => setTimeout(resolve, 3000))
          stop(session, profile)
          expect(page.reports.length).toBeGreaterThanOrEqual(round)
        }

        // Chromium restores the killed session's tab on the restart as well,
        // so the second round can report twice. Every load must be blurred.
        expect(new Set(page.reports)).toEqual(new Set(['blur(4px)']))
      },
      BUDGET_MS
    )
  }
})
