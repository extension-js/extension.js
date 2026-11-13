import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  browserConfig,
  DEFAULT_BROWSER_FLAGS,
  declaresDebuggerPermission,
  SILENT_DEBUGGER_FLAG as EXPORTED_FLAG,
  silentDebuggerFlagReport
} from '../run-chromium/chromium-launch/browser-config'

// Spelled out, so a spec never passes on a name that resolved to nothing.
const SILENT_DEBUGGER_FLAG = '--silent-debugger-extension-api'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function extensionDir(manifest: Record<string, unknown>, eol = '\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-debugger-bar-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {manifest_version: 3, name: 'x', version: '1.0.0', ...manifest},
      null,
      2
    )
      .split('\n')
      .join(eol)
  )

  return root
}

function flagsFor(
  extension: string | string[],
  options: Record<string, unknown> = {}
) {
  const out = path.join(os.tmpdir(), 'extjs-debugger-bar-out', 'dist', 'chrome')

  return browserConfig(
    {options: {mode: 'development', output: {path: out}}} as any,
    {extension, browser: 'chrome', ...options} as any,
    {provision: false}
  )
}

describe('the silent debugger flag', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = {...OLD_ENV}
    delete process.env.EXTENSION_BROWSER_FLAGS
  })

  afterEach(() => {
    process.env = OLD_ENV
  })

  it('stays a default for an extension that never attaches a debugger', () => {
    const plain = extensionDir({permissions: ['storage']})

    expect(EXPORTED_FLAG).toBe(SILENT_DEBUGGER_FLAG)
    expect(DEFAULT_BROWSER_FLAGS).toContain(SILENT_DEBUGGER_FLAG)
    expect(flagsFor(plain)).toContain(SILENT_DEBUGGER_FLAG)
  })

  for (const browser of ['chrome', 'edge', 'brave', 'chromium-based']) {
    it(`is left out on ${browser} when the manifest declares debugger`, () => {
      const debuggerExtension = extensionDir({
        permissions: ['storage', 'debugger']
      })

      expect(flagsFor(debuggerExtension, {browser})).not.toContain(
        SILENT_DEBUGGER_FLAG
      )
    })
  }

  it('is left out when debugger is only an optional permission', () => {
    const optional = extensionDir({optional_permissions: ['debugger']})

    expect(flagsFor(optional)).not.toContain(SILENT_DEBUGGER_FLAG)
  })

  it('reads a manifest saved with CRLF line endings', () => {
    const crlf = extensionDir({permissions: ['debugger']}, '\r\n')

    expect(declaresDebuggerPermission([crlf])).toBe(true)
    expect(flagsFor(crlf)).not.toContain(SILENT_DEBUGGER_FLAG)
  })

  it('is left out when any loaded extension declares debugger', () => {
    const companion = extensionDir({permissions: ['tabs']})
    const debuggerExtension = extensionDir({permissions: ['debugger']})

    expect(flagsFor([companion, debuggerExtension])).not.toContain(
      SILENT_DEBUGGER_FLAG
    )
  })

  it('stays when no manifest can be read', () => {
    const missing = path.join(os.tmpdir(), 'extjs-debugger-bar-missing')

    expect(declaresDebuggerPermission([missing])).toBe(false)
    expect(flagsFor(missing)).toContain(SILENT_DEBUGGER_FLAG)
  })

  it('is removed by excludeBrowserFlags', () => {
    const plain = extensionDir({permissions: ['storage']})
    const flags = flagsFor(plain, {
      excludeBrowserFlags: [SILENT_DEBUGGER_FLAG]
    })

    expect(flags).not.toContain(SILENT_DEBUGGER_FLAG)
    expect(flags).toContain('--no-first-run')
  })

  it('comes back through browserFlags for a debugger extension', () => {
    const debuggerExtension = extensionDir({permissions: ['debugger']})

    expect(
      flagsFor(debuggerExtension, {browserFlags: [SILENT_DEBUGGER_FLAG]})
    ).toContain(SILENT_DEBUGGER_FLAG)
  })

  it('comes back through EXTENSION_BROWSER_FLAGS for a debugger extension', () => {
    const debuggerExtension = extensionDir({permissions: ['debugger']})
    process.env.EXTENSION_BROWSER_FLAGS = SILENT_DEBUGGER_FLAG

    expect(flagsFor(debuggerExtension)).toContain(SILENT_DEBUGGER_FLAG)
  })
})

describe('silentDebuggerFlagReport', () => {
  const plain = () => extensionDir({permissions: ['storage']})
  const debuggerExtension = () => extensionDir({permissions: ['debugger']})

  it('names the flag, whether it is passed and how to change that', () => {
    const report = silentDebuggerFlagReport(
      ['--no-first-run', SILENT_DEBUGGER_FLAG],
      [plain()]
    )

    expect(report).toMatchObject({
      kind: 'browser_flag',
      value: '--silent-debugger-extension-api',
      applied: true,
      cause: 'default'
    })

    expect(report.change).toContain('excludeBrowserFlags')
    expect(report.change).toContain('"debugger"')
  })

  it('says the debugger permission left it out', () => {
    const report = silentDebuggerFlagReport(
      ['--no-first-run'],
      [debuggerExtension()]
    )

    expect(report).toMatchObject({
      applied: false,
      cause: 'debugger-permission'
    })

    expect(report.change).toContain('browserFlags')
  })

  it('says excludeBrowserFlags left it out', () => {
    expect(
      silentDebuggerFlagReport(['--no-first-run'], [plain()])
    ).toMatchObject({applied: false, cause: 'exclude-browser-flags'})
  })

  it('says a passed flag hides the bar of a debugger extension', () => {
    expect(
      silentDebuggerFlagReport([SILENT_DEBUGGER_FLAG], [debuggerExtension()])
    ).toMatchObject({applied: true, cause: 'browser-flags'})
  })
})
