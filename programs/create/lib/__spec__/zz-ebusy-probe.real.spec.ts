import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {runInstall} from '../install-runner'

// TEMPORARY measurement, removed before the branch is final.
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function once(inside: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ebusy-probe-'))
  const script = path.join(dir, 'manager.cjs')
  const ready = path.join(dir, 'started')

  fs.writeFileSync(
    script,
    `
    const {spawn} = require('node:child_process')
    const late = spawn(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1], '1'); setInterval(() => {}, 1000)", process.argv[2]], {stdio: 'ignore'})
    require('node:fs').writeSync(1, late.pid + ' ' + process.pid + '\\n')
    setInterval(() => {}, 1000)
  `
  )

  const asked = Date.now()
  const result = await runInstall(process.execPath, [script, ready], {
    cwd: inside ? dir : process.cwd(),
    stdio: 'pipe',
    timeoutMs: 4000
  })
  const returned = Date.now()
  const [grandchild, manager] = result.stdout.trim().split(' ').map(Number)
  const row: Record<string, unknown> = {
    inside,
    readyAtReturn: fs.existsSync(ready),
    grandchild,
    manager,
    returnMs: returned - asked
  }

  while (isRunning(grandchild) && Date.now() - returned < 20_000) await sleep(5)

  row.grandchildGoneMs = Date.now() - returned
  row.managerAliveThen = isRunning(manager)

  const errors: string[] = []
  let removed = false

  while (!removed && Date.now() - returned < 30_000) {
    try {
      fs.rmSync(dir, {recursive: true, force: true})
      removed = !fs.existsSync(dir)
    } catch (error) {
      const code = String((error as NodeJS.ErrnoException).code)

      if (errors.at(-1) !== code) errors.push(code)

      row.managerAliveAtLastError = isRunning(manager)
      row.lastErrorMs = Date.now() - returned
      await sleep(10)
    }
  }

  row.removed = removed
  row.removedMs = Date.now() - returned
  row.errors = errors

  while (isRunning(manager) && Date.now() - returned < 30_000) await sleep(5)

  row.managerGoneMs = Date.now() - returned

  return row
}

describe.runIf(process.platform === 'win32' || process.env.EBUSY_PROBE)(
  'TEMPORARY: what holds the folder after the tree is asked to end',
  () => {
    it('measures both working folders', async () => {
      const rows: Array<Record<string, unknown>> = []

      for (let turn = 0; turn < 10; turn += 1) {
        rows.push(await once(true))
        rows.push(await once(false))
      }

      for (const row of rows) {
        process.stderr.write(`EBUSY-PROBE ${JSON.stringify(row)}\n`)
      }

      expect(rows).toHaveLength(20)
    }, 600_000)
  }
)
