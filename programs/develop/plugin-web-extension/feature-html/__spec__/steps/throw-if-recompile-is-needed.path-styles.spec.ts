import {beforeEach, describe, expect, it, vi} from 'vitest'
import {asCompiler} from '../../../__spec__/helpers/rspack-fakes'

// The files that exist, by the exact path the step asks about, so the same
// project can be spelled with either separator on any machine.
const present = new Set<string>()
const pageScripts: Record<string, string[]> = {}

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()

  return {
    ...actual,
    existsSync: (file: string) => present.has(String(file)),
    readFileSync: () => '<html></html>'
  }
})

vi.mock('../../html-lib/utils', () => ({
  getAssetsFromHtml: (page: string) => ({js: pageScripts[page] || [], css: []}),
  missingPageEntryFiles: () => []
}))

const styles = {
  'forward slashes': {
    manifest: '/proj/manifest.json',
    page: '/proj/popup/index.html',
    main: '/proj/popup/main.js',
    gone: '/proj/popup/gone.js'
  },
  'a drive letter and backslashes': {
    manifest: 'C:\\proj\\manifest.json',
    page: 'C:\\proj\\popup\\index.html',
    main: 'C:\\proj\\popup\\main.js',
    gone: 'C:\\proj\\popup\\gone.js'
  }
}

async function errorsAfterSave(style: (typeof styles)[keyof typeof styles]) {
  const {ThrowIfRecompileIsNeeded} = await import(
    '../../steps/throw-if-recompile-is-needed'
  )
  const errors: Array<{name: string}> = []

  let make: (compilation: unknown, done: () => void) => void = () => {}

  const compiler = {
    options: {context: style.manifest.replace(/manifest\.json$/, '')},
    modifiedFiles: new Set<string>(),
    hooks: {
      make: {
        tapAsync: (_name: string, fn: typeof make) => {
          make = fn
        }
      }
    }
  }

  new ThrowIfRecompileIsNeeded({
    manifestPath: style.manifest,
    includeList: {'action/index': style.page}
  }).apply(asCompiler(compiler))

  // The script is deleted and the page saved, in one watch batch.
  present.delete(style.gone)
  compiler.modifiedFiles.add(style.page)
  make({errors}, () => {})

  return errors.map((error) => error.name)
}

describe('a page whose script lost its file', () => {
  beforeEach(() => {
    present.clear()
  })

  for (const [name, style] of Object.entries(styles)) {
    it(`asks for a restart when the paths use ${name}`, async () => {
      for (const file of [style.page, style.main, style.gone]) present.add(file)
      pageScripts[style.page] = [style.main, style.gone]

      expect(await errorsAfterSave(style)).toEqual(['HtmlEntrypointChanged'])
    })
  }
})
