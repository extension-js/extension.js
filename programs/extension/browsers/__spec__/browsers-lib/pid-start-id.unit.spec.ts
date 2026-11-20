import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {describe, expect, it} from 'vitest'
import {pidStartId, sameStartId} from '../../browsers-lib/resolve-live-pid'

const BOOT = '5b0c2f0e-1d2a-4c3b-9e8f-0a1b2c3d4e5f'

// A stat line as the kernel prints it: pid, the command in parentheses, the
// state, then the numbered fields. The start tick is field 22.
function statLine(pid: number, command: string, startTicks: string): string {
  const afterState = Array.from({length: 18}, (_unused, at) => String(at))

  return `${pid} (${command}) S ${afterState.join(' ')} ${startTicks} 99 98\n`
}

function proc(files: Record<string, string>) {
  return {
    platform: 'linux' as const,
    readFile: (file: string) => {
      if (!(file in files)) throw new Error(`ENOENT ${file}`)

      return files[file]
    }
  }
}

describe('pidStartId', () => {
  it('joins the boot id and the start tick of the pid', () => {
    expect(
      pidStartId(
        4242,
        proc({
          '/proc/4242/stat': statLine(4242, 'node', '8812345'),
          '/proc/sys/kernel/random/boot_id': `${BOOT}\n`
        })
      )
    ).toBe(`${BOOT}:8812345`)
  })

  it('counts the fields after the last parenthesis of the command name', () => {
    expect(
      pidStartId(
        4242,
        proc({
          '/proc/4242/stat': statLine(4242, 'web (a) b) 1 2 3', '77'),
          '/proc/sys/kernel/random/boot_id': BOOT
        })
      )
    ).toBe(`${BOOT}:77`)
  })

  it.each([
    'darwin',
    'win32'
  ] as const)('has no id on %s and reads nothing', (platform) => {
    const readFile = () => {
      throw new Error('read on a platform with no /proc')
    }

    expect(pidStartId(4242, {platform, readFile})).toBeUndefined()
  })

  it.each([
    ['the pid has no stat file', {'/proc/sys/kernel/random/boot_id': BOOT}],
    [
      'the boot id cannot be read',
      {'/proc/4242/stat': statLine(4242, 'n', '5')}
    ],
    [
      'the boot id is empty',
      {
        '/proc/4242/stat': statLine(4242, 'n', '5'),
        '/proc/sys/kernel/random/boot_id': '\n'
      }
    ],
    [
      'the start field is not a number',
      {
        '/proc/4242/stat': statLine(4242, 'n', 'soon'),
        '/proc/sys/kernel/random/boot_id': BOOT
      }
    ],
    [
      'the stat line is cut short',
      {
        '/proc/4242/stat': '4242 (n) S 1 2 3\n',
        '/proc/sys/kernel/random/boot_id': BOOT
      }
    ]
  ])('has no id when %s', (_title, files) => {
    expect(pidStartId(4242, proc(files))).toBeUndefined()
  })

  it.each([0, -1, 1.5, null, undefined])('has no id for pid %s', (pid) => {
    expect(pidStartId(pid, proc({}))).toBeUndefined()
  })
})

describe('sameStartId', () => {
  it('says yes or no when both sides have an id', () => {
    expect(sameStartId('boot:1', 7, () => 'boot:1')).toBe(true)
    expect(sameStartId('boot:1', 7, () => 'boot:2')).toBe(false)
    expect(sameStartId('boot-a:1', 7, () => 'boot-b:1')).toBe(false)
  })

  it('leaves the answer to the dates when either side has none', () => {
    const never = () => {
      throw new Error('asked with nothing to compare')
    }

    expect(sameStartId(undefined, 7, never)).toBeUndefined()
    expect(sameStartId('', 7, never)).toBeUndefined()
    expect(sameStartId(12, 7, never)).toBeUndefined()
    expect(sameStartId('boot:1', undefined, never)).toBeUndefined()
    expect(sameStartId('boot:1', 7, () => undefined)).toBeUndefined()
  })
})

// The one row that reads the real /proc, so Linux CI is what proves it.
describe.runIf(process.platform === 'linux')('pidStartId on Linux', () => {
  it('names this process, keeps the name, and names a child otherwise', async () => {
    const own = pidStartId(process.pid)

    expect(own).toMatch(/^[0-9a-f-]{36}:\d+$/)
    expect(pidStartId(process.pid)).toBe(own)

    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1e3)'],
      {
        stdio: 'ignore'
      }
    )

    try {
      const childId = pidStartId(child.pid)

      expect(childId).toMatch(/^[0-9a-f-]{36}:\d+$/)
      expect(childId).not.toBe(own)
      expect(childId?.split(':')[0]).toBe(own?.split(':')[0])
      expect(sameStartId(childId, child.pid)).toBe(true)
      expect(sameStartId(own, child.pid)).toBe(false)
    } finally {
      child.kill('SIGKILL')
      await once(child, 'exit')
    }

    expect(pidStartId(child.pid)).toBeUndefined()
  })
})

describe.skipIf(process.platform === 'linux')('pidStartId off Linux', () => {
  it('has no id for this process', () => {
    expect(pidStartId(process.pid)).toBeUndefined()
  })
})
