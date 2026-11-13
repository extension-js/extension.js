import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it, vi} from 'vitest'
import {printDevBannerOnce} from '../browsers-lib/banner'
import {devAdditionsNote} from '../browsers-lib/messages'
import {
  readReadyDevAdditions,
  readyPathFor,
  stampReadyDevBrowserFlag
} from '../browsers-lib/ready-stamp'

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')
const FLAG = '--silent-debugger-extension-api'
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function session(ready: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dev-additions-'))
  roots.push(root)
  const outPath = path.join(root, 'dist', 'chrome')
  fs.mkdirSync(outPath, {recursive: true})
  fs.writeFileSync(
    path.join(outPath, 'manifest.json'),
    JSON.stringify({name: 'Card Fixture', version: '1.0.0'})
  )

  const readyPath = readyPathFor(outPath)
  fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  fs.writeFileSync(readyPath, JSON.stringify(ready))

  return {
    outPath,
    read: () => JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
  }
}

const grants = [
  {kind: 'permission', value: 'scripting', reason: 'r'},
  {kind: 'permission', value: 'tabs', reason: 'r'},
  {kind: 'host_permission', value: '<all_urls>', reason: 'r'},
  {kind: 'web_accessible_resource', value: 'hot/*', reason: 'r'}
]

describe('stampReadyDevBrowserFlag', () => {
  it('adds the flag verdict beside the grants the dev server wrote', () => {
    const {outPath, read} = session({runId: 'run-1', devAdditions: grants})

    stampReadyDevBrowserFlag(
      outPath,
      {kind: 'browser_flag', value: FLAG, applied: true, cause: 'default'},
      'run-1'
    )

    expect(read().devAdditions).toEqual([
      ...grants,
      {kind: 'browser_flag', value: FLAG, applied: true, cause: 'default'}
    ])
  })

  it('replaces an earlier verdict for the same flag', () => {
    const {outPath, read} = session({runId: 'run-1'})

    stampReadyDevBrowserFlag(outPath, {
      kind: 'browser_flag',
      value: FLAG,
      applied: true
    })

    stampReadyDevBrowserFlag(outPath, {
      kind: 'browser_flag',
      value: FLAG,
      applied: false
    })

    expect(read().devAdditions).toEqual([
      {kind: 'browser_flag', value: FLAG, applied: false}
    ])
  })

  it("leaves another run's contract alone", () => {
    const {outPath, read} = session({runId: 'run-2', devAdditions: grants})

    stampReadyDevBrowserFlag(
      outPath,
      {kind: 'browser_flag', value: FLAG, applied: true},
      'run-1'
    )

    expect(read().devAdditions).toEqual(grants)
  })

  it('reads an absent or malformed list as empty', () => {
    expect(readReadyDevAdditions(session({}).outPath)).toEqual([])
    expect(
      readReadyDevAdditions(session({devAdditions: 'no'}).outPath)
    ).toEqual([])

    expect(readReadyDevAdditions(undefined)).toEqual([])
  })
})

describe('devAdditionsNote', () => {
  it('prints one line per kind and one per flag', () => {
    expect(
      plain(
        devAdditionsNote([
          ...grants,
          {kind: 'browser_flag', value: FLAG, applied: true, cause: 'default'}
        ])
      ).split('\n')
    ).toEqual([
      '    Dev only       permissions scripting, tabs',
      '    Dev only       host access <all_urls>',
      '    Dev only       web_accessible_resources hot/*',
      `    Dev flag       ${FLAG} hides the debugger bar, excludeBrowserFlags shows it`
    ])
  })

  it('says how each flag verdict is changed', () => {
    const line = (entry: {applied: boolean; cause?: string}) =>
      plain(devAdditionsNote([{kind: 'browser_flag', value: FLAG, ...entry}]))

    expect(line({applied: false, cause: 'debugger-permission'})).toBe(
      `    Dev flag       ${FLAG} left out for the debugger permission, browserFlags restores it`
    )

    expect(line({applied: false, cause: 'exclude-browser-flags'})).toBe(
      `    Dev flag       ${FLAG} left out by excludeBrowserFlags, the debugger bar shows`
    )

    expect(line({applied: true, cause: 'browser-flags'})).toBe(
      `    Dev flag       ${FLAG} hides the debugger bar, passed by browserFlags`
    )
  })

  it('prints nothing for an empty list', () => {
    expect(devAdditionsNote([])).toBe('')
  })
})

describe('the dev card', () => {
  it('prints the additions once, right under the card rows', async () => {
    const {outPath} = session({
      runId: 'run-1',
      devAdditions: [
        ...grants,
        {
          kind: 'browser_flag',
          value: FLAG,
          applied: false,
          cause: 'debugger-permission'
        }
      ]
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const print = () =>
      printDevBannerOnce({
        browser: 'chrome',
        outPath,
        hostPort: {host: '127.0.0.1', port: 49700},
        getInfo: async () => null
      })

    expect(await print()).toBe(true)
    expect(await print()).toBe(true)

    const output = plain(
      logSpy.mock.calls.map((call) => String(call[0] || '')).join('\n')
    )
    logSpy.mockRestore()

    expect(
      output.split('Dev only       permissions scripting, tabs').length
    ).toBe(2)

    expect(output).toContain(
      `Dev flag       ${FLAG} left out for the debugger permission`
    )

    expect(output.indexOf('Card Fixture 1.0.0')).toBeLessThan(
      output.indexOf('Dev only')
    )
  })

  it('stays the plain card when the contract carries no additions', async () => {
    const {outPath} = session({runId: 'run-1'})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await printDevBannerOnce({
      browser: 'chrome',
      outPath,
      hostPort: {host: '127.0.0.1', port: 49701},
      getInfo: async () => null
    })

    const output = logSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    logSpy.mockRestore()

    expect(output).toContain('Card Fixture')
    expect(output).not.toContain('Dev only')
    expect(output).not.toContain('Dev flag')
  })
})
