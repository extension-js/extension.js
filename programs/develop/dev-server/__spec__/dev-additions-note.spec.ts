import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi
} from 'vitest'
import {recordDevAdditions} from '../../lib/dev-additions'
import {setupNoBrowserBannerOnFirstDone} from '../compiler-hooks'
import {devAdditionsNote} from '../messages'

const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

const additions = [
  {kind: 'permission' as const, value: 'scripting', reason: 'r'},
  {kind: 'permission' as const, value: 'tabs', reason: 'r'},
  {kind: 'host_permission' as const, value: '<all_urls>', reason: 'r'},
  {
    kind: 'web_accessible_resource' as const,
    value: 'hot/*',
    matches: ['<all_urls>'],
    reason: 'r'
  },
  {
    kind: 'web_accessible_resource' as const,
    value: 'extension-js-control.json',
    matches: ['<all_urls>'],
    reason: 'r'
  }
]

describe('devAdditionsNote', () => {
  it('prints one line per kind, in the card row shape', () => {
    expect(plain(devAdditionsNote(additions)).split('\n')).toEqual([
      '    Dev only       permissions scripting, tabs',
      '    Dev only       host access <all_urls>',
      '    Dev only       web_accessible_resources hot/*, extension-js-control.json'
    ])
  })

  it('prints nothing when dev added nothing', () => {
    expect(devAdditionsNote([])).toBe('')
  })

  it('names a value once however many entries carry it', () => {
    const twice = [additions[3], {...additions[3], matches: ['https://a/*']}]

    expect(plain(devAdditionsNote(twice))).toBe(
      '    Dev only       web_accessible_resources hot/*'
    )
  })
})

describe('the no-browser card', () => {
  let consoleSpy: MockInstance<typeof console.log>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  const firstDone = (compilation: object) => {
    const compiler: any = {hooks: {done: {tap: vi.fn()}}}

    setupNoBrowserBannerOnFirstDone({
      compiler,
      browser: 'chromium',
      manifestPath: '/proj/manifest.json',
      readyPath: '/proj/dist/extension-js/chromium/ready.json',
      distPath: '/proj/dist/chromium'
    })

    const done = compiler.hooks.done.tap.mock.calls[0][1]
    done({hasErrors: () => false, compilation})
    done({hasErrors: () => false, compilation})

    return plain(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'))
  }

  it('says once, under the card, what dev added', () => {
    const compilation = {}
    recordDevAdditions(compilation, additions)

    const output = firstDone(compilation)

    expect(output.split('Dev only       permissions').length).toBe(2)
    expect(output).toContain('    Dev only       host access <all_urls>')
    expect(output.indexOf('(no-browser mode)')).toBeLessThan(
      output.indexOf('Dev only')
    )

    expect(output.indexOf('Dev only')).toBeLessThan(
      output.search(/ready for development/i)
    )
  })

  it('stays the plain card when the compile added nothing', () => {
    expect(firstDone({})).not.toContain('Dev only')
  })
})
