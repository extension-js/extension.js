/// <reference types="vite/client" />
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as messages from '../lib/messages'

// The same files as text, so a link is read as the terminal prints it.
const sources = import.meta.glob(
  ['../**/messages.ts', '!../**/node_modules/**', '!../**/dist/**'],
  {eager: true, query: '?raw', import: 'default'}
) as Record<string, string>

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const DESTINATION = '/cache/extension.js/browsers/chrome'
const INSTALL_ARGS = [
  '-y',
  '@puppeteer/browsers@2.0.0',
  'install',
  'chromium',
  '--path',
  DESTINATION
]

function plain(text: string): string {
  return text.replaceAll(ANSI, '')
}

function failed(result: {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
}): string {
  return messages.installFailed('chromium', 'npx', INSTALL_ARGS, {
    stdout: '',
    ...result
  })
}

interface MessageCase {
  // Thrown text lands in error.message and in the JSON envelope.
  thrown: boolean
  build: () => string
  carries: string[]
}

// One row per export, so a message added without its facts fails to compile.
const cases: Record<keyof typeof messages, MessageCase> = {
  installingBrowser: {
    thrown: false,
    build: () => messages.installingBrowser('chrome', DESTINATION, false),
    carries: ['Installing Chrome…', DESTINATION]
  },
  waitingForInstall: {
    thrown: false,
    build: () => messages.waitingForInstall('chrome', 41250),
    carries: [
      'Another install of Chrome is running (PID 41250)',
      'Waiting for it to finish…'
    ]
  },
  installTimedOut: {
    thrown: true,
    build: () => messages.installTimedOut('chrome', 1_800_000, true),
    carries: [
      "Couldn't install Chrome",
      "didn't finish within 30 minutes and was stopped",
      'The incomplete files were removed',
      'EXTENSION_INSTALL_TIMEOUT_MS',
      'run the install again'
    ]
  },
  installInterrupted: {
    thrown: true,
    build: () => messages.installInterrupted('firefox', 'SIGINT', true),
    carries: [
      "Couldn't install Firefox",
      'interrupted by SIGINT',
      'The incomplete files were removed',
      'Run the install again'
    ]
  },
  installBusy: {
    thrown: true,
    build: () =>
      messages.installBusy(
        'chrome',
        41250,
        90_000,
        '/cache/extension.js/browsers/.chrome.lock'
      ),
    carries: [
      "Couldn't install Chrome",
      'Another install of Chrome (PID 41250) was still running after 90 seconds',
      'Wait for it to finish',
      'delete /cache/extension.js/browsers/.chrome.lock'
    ]
  },
  foreignFolder: {
    thrown: true,
    build: () => messages.foreignFolder('chrome', DESTINATION),
    carries: [
      "Couldn't install Chrome",
      `The folder ${DESTINATION} holds files Extension.js didn't put there`,
      'nothing in it was changed',
      'EXT_BROWSERS_CACHE_DIR'
    ]
  },
  foreignFolderKept: {
    thrown: true,
    build: () => messages.foreignFolderKept(DESTINATION),
    carries: [DESTINATION, "didn't put there", 'nothing in it was removed']
  },
  brokenTreeLeftBehind: {
    thrown: false,
    build: () => messages.brokenTreeLeftBehind(DESTINATION),
    carries: [
      "The broken Edge files couldn't be removed",
      DESTINATION,
      'Delete that folder before the next install'
    ]
  },
  uninstallReasonForeign: {
    thrown: true,
    build: () => messages.uninstallReasonForeign(),
    carries: ["it holds files Extension.js didn't put there"]
  },
  uninstallReasonInstalling: {
    thrown: true,
    build: () => messages.uninstallReasonInstalling(41250),
    carries: ['an install of it is running, PID 41250']
  },
  installSucceeded: {
    thrown: false,
    build: () => messages.installSucceeded('firefox', DESTINATION),
    carries: ['Firefox is installed', DESTINATION]
  },
  edgeInstalledSystemWide: {
    thrown: false,
    build: () =>
      messages.edgeInstalledSystemWide('/usr/bin/microsoft-edge-stable'),
    carries: ['Edge is installed system-wide', '/usr/bin/microsoft-edge-stable']
  },
  edgeAlreadyInstalled: {
    thrown: false,
    build: () => messages.edgeAlreadyInstalled('/usr/bin/microsoft-edge'),
    carries: [
      'Edge is already installed system-wide',
      '/usr/bin/microsoft-edge'
    ]
  },
  installerNotFound: {
    thrown: true,
    build: () => messages.installerNotFound('firefox', 'bunx'),
    carries: [
      "Couldn't install Firefox",
      "package runner bunx wasn't found",
      'Install Bun',
      'a package manager that is installed'
    ]
  },
  brokenTreeNotRemoved: {
    thrown: true,
    build: () => messages.brokenTreeNotRemoved(DESTINATION),
    carries: [DESTINATION, "couldn't be removed", 'Delete that folder']
  },
  cacheRootUnusable: {
    thrown: true,
    build: () =>
      messages.cacheRootUnusable(
        'chrome',
        '/cache/extension.js/browsers',
        'is a file, not a folder'
      ),
    carries: [
      "Couldn't install Chrome",
      '/cache/extension.js/browsers is a file, not a folder',
      'EXT_BROWSERS_CACHE_DIR'
    ]
  },
  installFailed: {
    thrown: true,
    build: () =>
      failed({code: 9, signal: null, stderr: 'first line\nlast line\n'}),
    carries: [
      "Couldn't install Chromium",
      `npx ${INSTALL_ARGS.join(' ')}`,
      'exit code 9',
      'Run it yourself',
      'last line'
    ]
  },
  installIncomplete: {
    thrown: true,
    build: () => messages.installIncomplete('chrome', DESTINATION, true),
    carries: [
      "Couldn't install Chrome",
      DESTINATION,
      'no Chrome binary',
      'The incomplete files were removed',
      'Run the install again'
    ]
  },
  edgeInstallNeedsInteractivePrivilegedSession: {
    thrown: true,
    build: () => messages.edgeInstallNeedsInteractivePrivilegedSession(),
    carries: [
      'Edge',
      'Linux',
      'sudo can prompt',
      'sudo apt install microsoft-edge-stable',
      '--browser=edge',
      '--browser=chromium'
    ]
  },
  edgeInstallNeedsAdministratorPassword: {
    thrown: true,
    build: () => messages.edgeInstallNeedsAdministratorPassword(),
    carries: [
      'Edge',
      'administrator password on macOS',
      'Run this command in a terminal',
      '--browser=edge',
      '--browser=chromium'
    ]
  },
  edgePasswordPromptTimedOut: {
    thrown: true,
    build: () => messages.edgePasswordPromptTimedOut('linux', 300_000),
    carries: [
      'Edge needs your password for sudo on Linux',
      'within 5 minutes',
      'the install was stopped',
      'enter the password',
      'sudo apt install microsoft-edge-stable',
      '--browser=edge',
      '--browser=chromium'
    ]
  },
  edgeInstallUsingSystemBinary: {
    thrown: false,
    build: () =>
      messages.edgeInstallUsingSystemBinary('/usr/bin/microsoft-edge'),
    carries: [
      'Edge',
      'elevated privileges',
      'already on this system',
      '/usr/bin/microsoft-edge'
    ]
  },
  uninstallRequiresTarget: {
    thrown: true,
    build: () => messages.uninstallRequiresTarget(),
    carries: ['browser target is required', '--browser <name>', '--all']
  },
  uninstallingBrowsers: {
    thrown: false,
    build: () =>
      messages.uninstallingBrowsers('/cache/extension.js/browsers', [
        'chrome',
        'edge'
      ]),
    carries: ['Removing', 'chrome, edge', '/cache/extension.js/browsers']
  },
  uninstallSucceeded: {
    thrown: false,
    build: () => messages.uninstallSucceeded('edge', DESTINATION),
    carries: ['Edge is removed', DESTINATION]
  },
  uninstallNoop: {
    thrown: false,
    build: () => messages.uninstallNoop('firefox', DESTINATION),
    carries: ['Firefox is already absent', DESTINATION]
  },
  uninstallSkippedSystemEdge: {
    thrown: false,
    build: () =>
      messages.uninstallSkippedSystemEdge('/usr/bin/microsoft-edge-stable'),
    carries: [
      'Edge is a system install',
      "Extension.js doesn't remove",
      '/usr/bin/microsoft-edge-stable'
    ]
  },
  uninstallFailed: {
    thrown: true,
    build: () =>
      messages.uninstallFailed([
        {
          browser: 'chrome',
          removed: true,
          path: DESTINATION,
          outcome: 'removed'
        },
        {
          browser: 'firefox',
          removed: false,
          path: '/cache/extension.js/browsers/firefox',
          outcome: 'failed',
          reason: 'EBUSY: resource busy or locked'
        }
      ]),
    carries: [
      "Couldn't remove Firefox",
      '/cache/extension.js/browsers/firefox is still there',
      'EBUSY: resource busy or locked',
      'run the uninstall again'
    ]
  }
}

const names = Object.keys(cases) as Array<keyof typeof messages>
const thrownNames = names.filter((name) => cases[name].thrown)
const printedNames = names.filter((name) => !cases[name].thrown)

describe('install messages', () => {
  // Colors are forced on, so a thrown message that picks one up shows it.
  beforeEach(() => {
    vi.stubEnv('FORCE_COLOR', '1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('has a row for every message the package exports', () => {
    expect(Object.keys(messages).sort()).toEqual([...names].sort())
  })

  it.each(names)('%s carries the facts a reader acts on', (name) => {
    const text = plain(cases[name].build())

    for (const fact of cases[name].carries) expect(text).toContain(fact)
  })

  it.each(printedNames)('%s is colored when it is printed', (name) => {
    expect(cases[name].build()).toContain(ESC)
  })

  it.each(thrownNames)('%s is one plain line when it is thrown', (name) => {
    const text = cases[name].build()

    expect(text).not.toContain(ESC)
    expect(text).not.toContain('\n')
    expect(text).toBe(text.trim())
  })

  it.each([
    messages.edgeInstallNeedsAdministratorPassword(),
    messages.edgePasswordPromptTimedOut('darwin', 300_000)
  ])('names no Linux package manager in a macOS privilege message', (text) => {
    for (const linuxOnly of ['Linux', 'apt', 'dnf', 'package manager']) {
      expect(text).not.toContain(linuxOnly)
    }
  })

  it('says a default browser was not the caller choice', () => {
    const named = plain(
      messages.installingBrowser('chromium', DESTINATION, false)
    )
    const defaulted = plain(
      messages.installingBrowser('chromium', DESTINATION, true)
    )

    expect(defaulted).toContain('the default when no browser is named')
    expect(named).not.toContain('default')
  })

  // Nothing is installed into the Edge cache folder, so it is not named.
  it('says Edge installs system-wide and names no folder', () => {
    const text = plain(
      messages.installingBrowser('edge', '/cache/browsers/edge', false)
    )

    expect(text).toBe('⏵⏵⏵ Installing Edge system-wide…')
  })

  it.each([
    [1, '1 ms'],
    [999, '999 ms'],
    [1000, '1 second'],
    [1500, '1.5 seconds'],
    [45_000, '45 seconds'],
    [119_999, '120 seconds'],
    [120_000, '2 minutes'],
    [90 * 60_000, '90 minutes'],
    [1_800_000, '30 minutes']
  ])('words a timeout of %i ms as %s, never as zero', (ms, worded) => {
    expect(messages.installTimedOut('chrome', ms, false)).toBe(
      `Couldn't install Chrome. The installer didn't finish within ${worded} ` +
        `and was stopped. Set EXTENSION_INSTALL_TIMEOUT_MS to a larger ` +
        `number of milliseconds, then run the install again.`
    )
  })

  it('leaves the PID out of the lock messages when no holder could be read', () => {
    expect(plain(messages.waitingForInstall('edge', null))).toBe(
      '⏵⏵⏵ Another install of Edge is running. Waiting for it to finish…'
    )

    expect(messages.installBusy('edge', null, 500, '/c/.edge.lock')).toBe(
      "Couldn't install Edge. Another install of Edge was still running " +
        'after 500 ms. Wait for it to finish and run the install again, ' +
        'or delete /c/.edge.lock when no such install is running.'
    )

    expect(messages.uninstallReasonInstalling(null)).toBe(
      'an install of it is running'
    )
  })

  it.each([
    ['edgeInstalledSystemWide', messages.edgeInstalledSystemWide],
    ['edgeAlreadyInstalled', messages.edgeAlreadyInstalled],
    ['edgeInstallUsingSystemBinary', messages.edgeInstallUsingSystemBinary]
  ] as const)('%s adds the binary flag only for an Edge the launcher does not find', (_name, build) => {
    const hint =
      'Pass this path with --chromium-binary to run it, ' +
      "since Extension.js doesn't look there on its own."
    const found = plain(build('/usr/bin/microsoft-edge', true))
    const handed = plain(build('/opt/edge/msedge', false))

    expect(found).not.toContain('--chromium-binary')
    expect(found).toBe(plain(build('/usr/bin/microsoft-edge')))
    expect(handed.split('\n').slice(-2)).toEqual([
      'PATH /opt/edge/msedge',
      hint
    ])
  })

  it('remedies each kind of uninstall failure once, and says still there only for a removal', () => {
    const failed = (
      browser: 'chrome' | 'edge' | 'firefox',
      reason: string
    ) => ({
      browser,
      removed: false,
      path: `/c/${browser}`,
      outcome: 'failed' as const,
      reason
    })

    expect(
      messages.uninstallFailed(
        [
          failed('chrome', "it holds files Extension.js didn't put there"),
          failed('edge', 'EPERM'),
          failed('firefox', 'an install of it is running, PID 7')
        ],
        ['foreign', 'removal', 'installing']
      )
    ).toBe(
      "Couldn't remove Chrome, Edge, Firefox. " +
        "/c/chrome was left untouched (it holds files Extension.js didn't put there). " +
        '/c/edge is still there (EPERM). ' +
        '/c/firefox was left untouched (an install of it is running, PID 7). ' +
        'Close any browser running from that folder, then run the uninstall again. ' +
        'Extension.js removes only the folders it installed, so delete that one yourself if you mean to. ' +
        'Wait for the install to finish, then run the uninstall again.'
    )
  })

  it('names the signal when the installer was killed', () => {
    const text = failed({code: null, signal: 'SIGTERM', stderr: ''})

    expect(text).toContain('was killed by SIGTERM')
    expect(text).not.toContain('exit code')
  })

  it('quotes only the last line the installer wrote, without its colors', () => {
    const text = failed({
      code: 1,
      signal: null,
      stderr: `first line\r\n${ESC}[31m  fake npx failure${ESC}[0m\n\n`
    })

    expect(text).toMatch(/Its output ended with: fake npx failure$/)
    expect(text).not.toContain('first line')
    expect(text).not.toContain(ESC)
  })

  it('quotes nothing when the installer wrote nothing', () => {
    const text = failed({code: 1, signal: null, stderr: ' \n'})

    expect(text).toMatch(/Run it yourself to see the full error\.$/)
  })

  it('claims a removal only when the incomplete files were removed', () => {
    const kept = messages.installIncomplete('firefox', DESTINATION, false)

    expect(kept).toContain("Couldn't install Firefox")
    expect(kept).toContain('Run the install again')
    expect(kept).not.toContain('removed')
  })

  it('names the owner of each runner, and the runner itself when it has none', () => {
    const owners = [
      ['npx', 'Install npm,'],
      ['npx.cmd', 'Install npm,'],
      ['pnpm', 'Install pnpm,'],
      ['yarn', 'Install Yarn,'],
      ['bunx.CMD', 'Install Bun,'],
      ['some-runner', 'Install some-runner,']
    ]

    for (const [command, remedy] of owners) {
      expect(messages.installerNotFound('chrome', command)).toContain(remedy)
    }
  })

  it('names only the browsers that would not go', () => {
    const text = messages.uninstallFailed([
      {browser: 'chrome', removed: true, path: '/c/chrome', outcome: 'removed'},
      {
        browser: 'edge',
        removed: false,
        path: '/c/edge',
        outcome: 'failed',
        reason: 'EPERM'
      }
    ])

    expect(text).toBe(
      "Couldn't remove Edge. /c/edge is still there (EPERM). " +
        'Close any browser running from that folder, then run the uninstall again.'
    )
  })

  // A link a user copies from the terminal is the plain address.
  it('prints no link with a tracking parameter', () => {
    const tracked = Object.keys(sources).filter((file) =>
      sources[file].includes('utm_')
    )

    expect(Object.keys(sources)).toEqual(['../lib/messages.ts'])
    expect(tracked).toEqual([])
  })
})
