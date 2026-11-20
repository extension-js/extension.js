import {describe, expect, it} from 'vitest'
import {
  executableOf,
  findLiveBrowserPid,
  listProcesses,
  type ProcessRow,
  type ProcessTableIo,
  parseProcessRows,
  resolveLiveBrowserPid
} from '../../browsers-lib/resolve-live-pid'

const BIN =
  '/Users/dev/Library/Caches/extension.js/browsers/firefox/Firefox Nightly.app/Contents/MacOS/firefox'
const HELPER =
  '/Users/dev/Library/Caches/extension.js/browsers/firefox/Firefox Nightly.app/Contents/MacOS/plugin-container.app/Contents/MacOS/plugin-container'
const PROFILE = '/tmp/proj/dist/extension-js/profiles/firefox-profile/keen-newt'
const ARGS = `--no-remote --new-instance -profile ${PROFILE} -start-debugger-server 9222`
// What ps -E prints for a Firefox that relaunched itself on macOS: a blank
// argv, then the environment that carries the profile.
const HANDOFF_ENV = `PWD=/tmp/proj MOZ_CRASHREPORTER_EVENTS_DIRECTORY=${PROFILE}/crashes/events XRE_PROFILE_PATH=${PROFILE} MOZ_LAUNCHED_CHILD=1`

const row = (pid: number, ppid: number, command: string): ProcessRow => ({
  pid,
  ppid,
  command
})

const launcher = row(31246, 31000, `${BIN} ${ARGS}`)
const helperOfLauncher = row(
  31250,
  31246,
  `${HELPER} -parentBuildID 1 -profile ${PROFILE} -childID 1`
)
const twin = row(31279, 31246, `${BIN} ${HANDOFF_ENV}`)
const twinReparented = row(31279, 1, `${BIN} ${HANDOFF_ENV}`)
const helperOfTwin = row(
  31290,
  31279,
  `${HELPER} -parentBuildID 1 -profile ${PROFILE} -childID 2`
)
const unrelated = row(400, 1, `${BIN} --no-remote -profile /tmp/other/profile`)
const devServer = row(31000, 1, 'node extension dev --browser firefox')
// A consumer that exported the profile path is not the browser.
const consumer = row(
  31500,
  1,
  `node recorder.js EXTENSION_PROFILE=${PROFILE} XRE_PROFILE_PATH=${PROFILE}`
)

describe('findLiveBrowserPid', () => {
  it('prefers the process the launcher handed the session to while both live', () => {
    const pid = findLiveBrowserPid({
      profilePath: PROFILE,
      binary: BIN,
      launcherPid: launcher.pid,
      rows: [devServer, launcher, helperOfLauncher, twin, unrelated, consumer]
    })

    expect(pid).toBe(twin.pid)
  })

  it('keeps the launcher when only helper processes share the profile', () => {
    const pid = findLiveBrowserPid({
      profilePath: PROFILE,
      binary: BIN,
      launcherPid: launcher.pid,
      rows: [devServer, launcher, helperOfLauncher, unrelated, consumer]
    })

    expect(pid).toBe(launcher.pid)
  })

  it('does not mistake a same-binary content process for a handoff', () => {
    const linuxBin = '/usr/lib/firefox/firefox'
    const main = row(500, 1, `${linuxBin} ${ARGS}`)
    const content = row(
      510,
      500,
      `${linuxBin} -contentproc -childID 1 -isForBrowser -profile ${PROFILE} tab`
    )

    expect(
      findLiveBrowserPid({
        profilePath: PROFILE,
        binary: linuxBin,
        launcherPid: main.pid,
        rows: [main, content]
      })
    ).toBe(main.pid)
  })

  it('finds the reparented owner once the launcher is gone', () => {
    const pid = findLiveBrowserPid({
      profilePath: PROFILE,
      binary: BIN,
      launcherPid: launcher.pid,
      rows: [devServer, twinReparented, helperOfTwin, unrelated, consumer]
    })

    expect(pid).toBe(twinReparented.pid)
  })

  it('never adopts an orphaned helper as the browser', () => {
    const orphanHelper = row(31290, 1, helperOfTwin.command)

    expect(
      findLiveBrowserPid({
        profilePath: PROFILE,
        binary: BIN,
        launcherPid: launcher.pid,
        rows: [devServer, orphanHelper, unrelated, consumer]
      })
    ).toBeNull()
  })

  it('needs the profile as a whole argument or value, not a substring', () => {
    const sibling = row(600, 1, `${BIN} --no-remote -profile ${PROFILE}-copy`)
    const nested = row(
      610,
      1,
      `${BIN} MOZ_CRASHREPORTER_EVENTS_DIRECTORY=${PROFILE}/crashes/events`
    )

    expect(
      findLiveBrowserPid({
        profilePath: PROFILE,
        binary: BIN,
        rows: [sibling, nested]
      })
    ).toBeNull()
  })

  it('returns null when nothing carries the profile', () => {
    expect(
      findLiveBrowserPid({
        profilePath: PROFILE,
        binary: BIN,
        launcherPid: launcher.pid,
        rows: [devServer, unrelated]
      })
    ).toBeNull()

    expect(
      findLiveBrowserPid({profilePath: '', binary: BIN, rows: [launcher]})
    ).toBeNull()
  })

  it('reads the Windows shape: quoted binary, backslash paths, any case', () => {
    const winBin = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
    const winProfile =
      'C:\\proj\\dist\\extension-js\\profiles\\firefox-profile\\keen-newt'
    const winArgs = `--no-remote --new-instance -profile ${winProfile}`
    const winLauncher = row(700, 600, `"${winBin}" ${winArgs}`)
    const winTwin = row(710, 700, `"${winBin}" ${winArgs}`)
    const winContent = row(
      720,
      710,
      `"${winBin}" -contentproc --channel=1 -childID 1 -profile ${winProfile}`
    )

    expect(
      findLiveBrowserPid({
        profilePath: winProfile,
        binary: winBin.toLowerCase(),
        launcherPid: winLauncher.pid,
        rows: [winLauncher, winTwin, winContent]
      })
    ).toBe(winTwin.pid)

    expect(
      findLiveBrowserPid({
        profilePath: winProfile.replace(/\\/g, '/'),
        binary: winBin,
        launcherPid: winLauncher.pid,
        rows: [winTwin, winContent]
      })
    ).toBe(winTwin.pid)
  })
})

describe('parseProcessRows', () => {
  it('parses the three-column ps and PowerShell output', () => {
    const rows = parseProcessRows(
      [
        '    1     0 /sbin/launchd',
        `31246 31000 ${BIN} ${ARGS}`,
        '',
        'garbage line',
        `710 700 "C:\\Program Files\\Mozilla Firefox\\firefox.exe" -profile C:\\p\r`
      ].join('\n')
    )

    expect(rows).toEqual([
      {pid: 1, ppid: 0, command: '/sbin/launchd'},
      {pid: 31246, ppid: 31000, command: `${BIN} ${ARGS}`},
      {
        pid: 710,
        ppid: 700,
        command:
          '"C:\\Program Files\\Mozilla Firefox\\firefox.exe" -profile C:\\p'
      }
    ])
  })
})

// Each platform asks its own tool, and no host runs all three, so the tool is
// stood in for and the question it was asked is what the row reads.
describe('listProcesses', () => {
  const tableOf = (answer: {
    output: string | null
    files?: Record<string, string>
  }) => {
    const asked: Array<{bin: string; args: string[]}> = []
    const read: string[] = []
    const io: ProcessTableIo = {
      run: (bin, args) => {
        asked.push({bin, args})

        return answer.output
      },
      readFile: (file) => {
        read.push(file)

        const content = answer.files?.[file]
        if (content === undefined) throw new Error(`ENOENT ${file}`)

        return content
      }
    }

    return {io, asked, read}
  }

  it('asks ps for the environment on macOS, where a relaunched browser has a blank argv', () => {
    const table = tableOf({
      output: [
        `31246 31000 ${BIN} ${ARGS}`,
        `31279 31246 ${BIN} ${HANDOFF_ENV}`
      ].join('\n')
    })
    const rows = listProcesses('darwin', table.io)

    expect(table.asked).toEqual([
      {bin: 'ps', args: ['-axEo', 'pid=,ppid=,command=']}
    ])

    expect(table.read).toEqual([])
    expect(
      findLiveBrowserPid({
        profilePath: PROFILE,
        binary: BIN,
        launcherPid: 31246,
        rows
      })
    ).toBe(31279)
  })

  it('reads the handoff variable from /proc on Linux, where ps prints no environment', () => {
    const linuxBin = '/home/dev/.cache/extension.js/browsers/firefox/firefox'
    const table = tableOf({
      output: [
        `31246 31000 ${linuxBin} ${ARGS}`,
        `31279 31246 ${linuxBin}`,
        `31300 1 /usr/bin/node server.js`
      ].join('\n'),
      files: {
        '/proc/31246/environ': 'HOME=/home/dev\0PWD=/tmp/proj\0',
        '/proc/31279/environ': `HOME=/home/dev\0XRE_PROFILE_PATH=${PROFILE}\0MOZ_LAUNCHED_CHILD=1\0`
      }
    })
    const rows = listProcesses('linux', table.io)

    expect(table.asked).toEqual([
      {bin: 'ps', args: ['-axo', 'pid=,ppid=,command=']}
    ])

    expect(table.read).toEqual([
      '/proc/31246/environ',
      '/proc/31279/environ',
      '/proc/31300/environ'
    ])

    // A process whose environment cannot be read keeps its row as ps gave it.
    expect(rows).toEqual([
      row(31246, 31000, `${linuxBin} ${ARGS}`),
      row(31279, 31246, `${linuxBin} XRE_PROFILE_PATH=${PROFILE}`),
      row(31300, 1, '/usr/bin/node server.js')
    ])

    expect(
      findLiveBrowserPid({
        profilePath: PROFILE,
        binary: linuxBin,
        launcherPid: 31246,
        rows
      })
    ).toBe(31279)
  })

  it('asks PowerShell on Windows, with no profile script and no prompt', () => {
    const table = tableOf({
      output:
        '5120 4000 "C:\\Mozilla Firefox\\firefox.exe" -profile C:\\p\\keen-newt\r\n' +
        '5200 5120 "C:\\Mozilla Firefox\\firefox.exe" -contentproc -profile C:\\p\\keen-newt\r\n'
    })
    const rows = listProcesses('win32', table.io)

    expect(table.asked).toHaveLength(1)
    expect(table.asked[0].bin).toBe('powershell.exe')
    expect(table.asked[0].args.slice(0, 3)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command'
    ])

    expect(table.asked[0].args[3]).toContain('Get-CimInstance Win32_Process')
    expect(table.read).toEqual([])
    expect(
      findLiveBrowserPid({
        profilePath: 'C:\\p\\keen-newt',
        binary: 'C:\\Mozilla Firefox\\firefox.exe',
        launcherPid: 5120,
        rows
      })
    ).toBe(5120)
  })

  it.each([
    'darwin',
    'linux',
    'win32'
  ] as const)('answers no rows on %s when the tool gives nothing', (platform) => {
    const table = tableOf({output: null})

    expect(listProcesses(platform, table.io)).toEqual([])
    expect(table.read).toEqual([])
  })
})

describe('executableOf', () => {
  it('keeps a binary path with spaces whole, before options or environment', () => {
    const bin = BIN.toLowerCase()
    expect(executableOf(`${BIN} ${ARGS}`)).toBe(bin)
    expect(executableOf(`${BIN} ${HANDOFF_ENV}`)).toBe(bin)
    expect(
      executableOf(`"C:\\Mozilla Firefox\\firefox.exe" -profile C:\\p`)
    ).toBe('c:/mozilla firefox/firefox.exe')

    expect(executableOf('/usr/bin/firefox')).toBe('/usr/bin/firefox')
  })
})

describe('resolveLiveBrowserPid', () => {
  it('answers as soon as the handoff shows up in the process table', async () => {
    const tables: ProcessRow[][] = [
      [devServer, launcher],
      [devServer, launcher, twin],
      [devServer, twinReparented]
    ]
    const slept: number[] = []

    const pid = await resolveLiveBrowserPid({
      profilePath: PROFILE,
      binary: BIN,
      launcherPid: launcher.pid,
      list: () => tables.shift() || [devServer, twinReparented],
      attempts: 6,
      intervalMs: 500,
      sleep: async (ms) => {
        slept.push(ms)
      }
    })

    expect(pid).toBe(twin.pid)
    expect(slept).toEqual([500])
  })

  it('keeps the launcher pid when no handoff happens in the window', async () => {
    let calls = 0
    const slept: number[] = []

    const pid = await resolveLiveBrowserPid({
      profilePath: PROFILE,
      binary: BIN,
      launcherPid: launcher.pid,
      list: () => {
        calls += 1

        return [devServer, launcher, helperOfLauncher]
      },
      attempts: 4,
      intervalMs: 250,
      sleep: async (ms) => {
        slept.push(ms)
      }
    })

    expect(pid).toBe(launcher.pid)
    expect(calls).toBe(4)
    expect(slept).toEqual([250, 250, 250])
  })

  it('returns null when the process table never carries the profile', async () => {
    const pid = await resolveLiveBrowserPid({
      profilePath: PROFILE,
      binary: BIN,
      launcherPid: launcher.pid,
      list: () => [devServer, unrelated],
      attempts: 2,
      sleep: async () => {}
    })

    expect(pid).toBeNull()
  })
})
