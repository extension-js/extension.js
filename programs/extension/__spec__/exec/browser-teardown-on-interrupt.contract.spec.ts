import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {plantBrowserStandIn} from '../helpers/browser-stand-in'
import {interruptCli} from '../helpers/console-interrupt'
import {freshCliHome, startCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

type Command = 'start' | 'preview' | 'dev'
type Browser = 'chrome' | 'firefox'

interface InterruptRun {
  interrupt: string
  status: number | null
  stdout: string
  stderr: string
  // From Ctrl+C to the exit of the CLI.
  quitMs: number
  // The stand-in and the child it started, and whether each one ended.
  tree: Array<{name: string; pid: number; ended: boolean}>
}

const QUIT_CEILING_MS = 30_000

const CASES: Array<[Command, Browser, string]> = [
  ['preview', 'chrome', '--chromium-binary'],
  ['start', 'chrome', '--chromium-binary'],
  ['dev', 'chrome', '--chromium-binary'],
  ['preview', 'firefox', '--gecko-binary']
]

const makeTemp = trackTempFolders()

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

async function endedWithin(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms

  while (isAlive(pid)) {
    if (Date.now() > deadline) return false

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }

  return true
}

// The pin is a stand-in that answers its version, starts a child of its
// own and stays up, the shape of a browser with a helper process.
async function interruptRun(
  command: Command,
  browser: Browser,
  flag: string
): Promise<InterruptRun> {
  const home = freshCliHome()
  const work = makeTemp('extjs-interrupt-tree-')
  const projectDir = join(work, 'project')
  mkdirSync(projectDir, {recursive: true})
  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Interrupt Tree',
      version: '1.0.0'
    })
  )

  const bin = join(work, 'bin')
  const pidFile = join(bin, 'browser.pid')
  const childPidFile = join(bin, 'child.pid')
  const binary = plantBrowserStandIn(bin, browser, {
    version: 'Stand-in 999.0.1234.5',
    pidFile,
    childPidFile
  })
  const session = startCli(
    [
      command,
      projectDir,
      '--browser',
      browser,
      flag,
      binary,
      '--output',
      'json'
    ],
    {home}
  )
  const run: Partial<InterruptRun> = {tree: []}
  const read = (file: string) => Number(readFileSync(file, 'utf8').trim())

  try {
    await session.waitFor(
      () =>
        existsSync(pidFile) &&
        existsSync(childPidFile) &&
        read(pidFile) > 0 &&
        read(childPidFile) > 0,
      90_000,
      'the stand-in browser and its child to be running'
    )

    const asked = Date.now()
    const ceiling = setTimeout(() => session.killGroup(), QUIT_CEILING_MS)

    run.interrupt = interruptCli(session.child, bin)

    try {
      run.status = (await session.closed).status
    } finally {
      clearTimeout(ceiling)
    }

    run.quitMs = Date.now() - asked
  } finally {
    const output = session.read()

    run.stdout = output.stdout
    run.stderr = output.stderr
    session.killGroup()

    // What outlives the CLI is ended by number, so no run leaks a process.
    for (const [name, file] of [
      ['the browser', pidFile],
      ['its child', childPidFile]
    ]) {
      if (!existsSync(file)) continue

      const pid = read(file)
      const ended = await endedWithin(pid, 2_000)

      run.tree?.push({name, pid, ended})

      if (!ended) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Already gone
        }
      }
    }
  }

  return run as InterruptRun
}

describe('a session interrupted with Ctrl+C while its browser runs', () => {
  const runs = new Map<string, Promise<InterruptRun>>()

  // Each run has its own project, home and stand-in, so they overlap.
  beforeAll(async () => {
    for (const [command, browser, flag] of CASES) {
      runs.set(`${command} ${browser}`, interruptRun(command, browser, flag))
    }

    await Promise.allSettled(runs.values())
  }, 240_000)

  it.each(
    CASES.map(([command, browser]) => [command, browser])
  )('%s on %s leaves neither the browser nor its child running', async (command, browser) => {
    const run = await (runs.get(
      `${command} ${browser}`
    ) as Promise<InterruptRun>)
    const context = `${run.interrupt} status=${run.status} quitMs=${run.quitMs}\n${run.stdout}\n${run.stderr}`

    console.log(
      `TEARDOWN ${command} ${browser} ${run.interrupt} status=${run.status} quitMs=${run.quitMs} ` +
        `tree=${JSON.stringify(run.tree)} last=${run.stdout.trim().split('\n').at(-1)?.slice(0, 300)}`
    )

    expect(
      run.tree.map((entry) => entry.name),
      context
    ).toEqual(['the browser', 'its child'])

    expect(
      run.tree.filter((entry) => !entry.ended),
      context
    ).toEqual([])

    // The CLI left by itself, before the ceiling ended it.
    expect(run.quitMs, context).toBeLessThan(QUIT_CEILING_MS)
  })
})
