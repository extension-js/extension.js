import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {windowsTaskkillPath} from '../../browsers/browsers-lib/process-teardown'
import {interruptCli} from '../helpers/console-interrupt'
import {type CliSession, freshCliHome, startCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

type Browser = 'chrome' | 'firefox'
type Mode = 'headless' | 'headed'

interface Row {
  pid: number
  parent: number
  name: string
}

const BINARIES: Record<Browser, {flag: string; paths: string[]}> = {
  chrome: {
    flag: '--chromium-binary',
    paths: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ]
  },
  firefox: {
    flag: '--gecko-binary',
    paths: [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
    ]
  }
}

const POLITE_BOUND_MS = 10_000
const makeTemp = trackTempFolders()

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

function listProcesses(): Row[] {
  const listed = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }'
    ],
    {encoding: 'utf8', windowsHide: true, timeout: 30_000}
  )

  return String(listed.stdout || '')
    .split(/\r?\n/)
    .map((line) => /^(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line))
    .filter((row): row is RegExpExecArray => row !== null)
    .map((row) => ({
      pid: Number(row[1]),
      parent: Number(row[2]),
      name: row[3]
    }))
}

// Every browser process under the CLI or under the pid it adopted.
function browserTree(roots: number[], browser: Browser): Row[] {
  const rows = listProcesses()
  const kept = new Set(roots)

  for (let grew = true; grew; ) {
    grew = false

    for (const row of rows) {
      if (kept.has(row.pid) || !kept.has(row.parent)) continue

      kept.add(row.pid)
      grew = true
    }
  }

  return rows.filter(
    (row) => kept.has(row.pid) && row.name.toLowerCase() === `${browser}.exe`
  )
}

function readReady(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

async function goneWithin(pids: number[], ms: number): Promise<number> {
  const started = Date.now()

  while (pids.some(isAlive)) {
    if (Date.now() - started > ms) return -1

    await sleep(25)
  }

  return Date.now() - started
}

function forceTree(pids: number[]): void {
  for (const pid of pids) {
    if (!isAlive(pid)) continue

    spawnSync(windowsTaskkillPath(), ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 15_000
    })
  }
}

interface Launched {
  session: CliSession
  work: string
  tree: Row[]
  root: number
  reachedReady: boolean
  upMs: number
}

async function launch(
  browser: Browser,
  mode: Mode,
  binary: string
): Promise<Launched> {
  const home = freshCliHome()
  const work = makeTemp('extjs-polite-')
  const projectDir = join(work, 'project')
  mkdirSync(projectDir, {recursive: true})
  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: browser === 'firefox' ? 2 : 3,
      name: 'Polite Close',
      version: '1.0.0'
    })
  )

  const readyFile = join(
    projectDir,
    'dist',
    'extension-js',
    browser,
    'ready.json'
  )
  const began = Date.now()
  const session = startCli(
    [
      'preview',
      projectDir,
      '--browser',
      browser,
      BINARIES[browser].flag,
      binary,
      '--output',
      'json'
    ],
    {home, env: {EXTENSION_HEADLESS: mode === 'headless' ? '1' : undefined}}
  )

  await session.waitFor(
    () => typeof readReady(readyFile)?.browserPid === 'number',
    120_000,
    'the browser to be launched'
  )

  let reachedReady = false
  const deadline = Date.now() + 45_000

  while (Date.now() < deadline) {
    if (readReady(readyFile)?.status === 'ready') {
      reachedReady = true
      break
    }

    await sleep(200)
  }

  const upMs = Date.now() - began
  // Helpers start after the main process, so the tree is read once settled.
  await sleep(2_000)

  const root = Number(readReady(readyFile)?.browserPid)
  const cliPid = session.child.pid ?? 0
  const tree = browserTree([cliPid, root], browser)

  return {session, work, tree, root, reachedReady, upMs}
}

function cleanup(run: Launched): void {
  forceTree(run.tree.map((row) => row.pid))
  run.session.killGroup()
}

async function politeRun(
  browser: Browser,
  mode: Mode,
  binary: string,
  index: number
): Promise<string> {
  const run = await launch(browser, mode, binary)
  const pids = run.tree.map((row) => row.pid)

  try {
    const asked = Date.now()
    const sent = spawnSync(
      windowsTaskkillPath(),
      ['/PID', String(run.root), '/T'],
      {encoding: 'utf8', windowsHide: true, timeout: 15_000}
    )
    const taskkillMs = Date.now() - asked
    const goneMs = await goneWithin(pids, POLITE_BOUND_MS)
    const elapsed = Date.now() - asked
    const left = pids.filter(isAlive).length
    const said = `${sent.stdout || ''} ${sent.stderr || ''}`
      .replace(/\s+/g, ' ')
      .trim()

    return `POLITE-CLOSE ${browser} ${mode} run=${index} ready=${run.reachedReady} upMs=${run.upMs} tree=${pids.length} taskkillExit=${sent.status} taskkillMs=${taskkillMs} goneMs=${goneMs} elapsedMs=${elapsed} leftAfterBound=${left} taskkill="${said.slice(0, 400)}"`
  } finally {
    cleanup(run)
  }
}

async function cliQuitRun(
  browser: Browser,
  mode: Mode,
  binary: string,
  index: number
): Promise<string> {
  const run = await launch(browser, mode, binary)
  const pids = run.tree.map((row) => row.pid)

  try {
    const asked = Date.now()
    const ceiling = setTimeout(() => run.session.killGroup(), 30_000)
    const interrupt = interruptCli(run.session.child, run.work)
    let status: number | null = null

    try {
      status = (await run.session.closed).status
    } finally {
      clearTimeout(ceiling)
    }

    const quitMs = Date.now() - asked
    const left = pids.filter(isAlive).length
    const goneAfterMs = await goneWithin(pids, 3_000)
    const stderr = run.session.read().stderr.replace(/\s+/g, ' ').trim()

    return `CLI-QUIT ${browser} ${mode} run=${index} ready=${run.reachedReady} tree=${pids.length} interrupt="${interrupt}" status=${status} quitMs=${quitMs} leftAtExit=${left} goneAfterExitMs=${goneAfterMs} stderr="${stderr.slice(-300)}"`
  } finally {
    cleanup(run)
  }
}

describe.runIf(process.platform === 'win32')(
  'a real browser asked to close politely on Windows',
  () => {
    for (const browser of ['chrome', 'firefox'] as const) {
      for (const mode of ['headless', 'headed'] as const) {
        it(`${browser} ${mode}: times the polite ask and the CLI quit`, async () => {
          const binary = BINARIES[browser].paths.find((file) =>
            existsSync(file)
          )

          if (!binary) {
            console.log(`POLITE-CLOSE ${browser} ${mode} no binary found`)

            return
          }

          const lines: string[] = []

          for (let index = 1; index <= 3; index++) {
            try {
              lines.push(await politeRun(browser, mode, binary, index))
            } catch (error) {
              lines.push(
                `POLITE-CLOSE ${browser} ${mode} run=${index} error=${String(error).slice(0, 600)}`
              )
            }

            console.log(lines.at(-1))
          }

          for (let index = 1; index <= 2; index++) {
            try {
              lines.push(await cliQuitRun(browser, mode, binary, index))
            } catch (error) {
              lines.push(
                `CLI-QUIT ${browser} ${mode} run=${index} error=${String(error).slice(0, 600)}`
              )
            }

            console.log(lines.at(-1))
          }

          expect(lines.length).toBe(5)
        }, 600_000)
      }
    }
  }
)
