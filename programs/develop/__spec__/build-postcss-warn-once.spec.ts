import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function project(postCssConfig: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-postcss-once-'))
  roots.push(root)

  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'postcss-once',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'postcss-once',
      version: '1.0.0',
      options_ui: {page: 'options.html'},
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content/script.js'],
          css: ['content/style.css']
        }
      ]
    }),
    'content/script.js': 'document.documentElement.dataset.once = "1"\n',
    'content/style.css': '.a { color: red; }\n',
    'page.css': '.b { color: blue; }\n',
    'options.html':
      '<!doctype html><html><head><link rel="stylesheet" href="page.css"></head><body></body></html>',
    'postcss.config.js': postCssConfig
  }

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string, browser: 'chrome' | 'firefox') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

// Every line either console method printed that holds the given text.
function printed(spies: Array<{mock: {calls: unknown[][]}}>, text: string) {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((call) => call.map(String).join(' '))
    .filter((line) => line.includes(text))
}

// A compiler builds one style rule per file type and per place a sheet can
// load, and each of them reads the PostCSS config again.
describe('a PostCSS finding is said once per build', () => {
  it.each([
    'chrome',
    'firefox'
  ] as const)('names each plugin it could not resolve once on %s', async (browser) => {
    const root = project(
      "module.exports = {plugins: {'postcss-plugin-nobody-installed': {}, 'postcss-second-missing-plugin': {}}}\n"
    )
    const spies = [
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    ]

    await build(root, browser)

    expect(
      printed(spies, "Couldn't resolve the PostCSS plugin")
        .map((line) => line.split('\n')[0].replace(/^.*plugin /, ''))
        .sort()
    ).toEqual([
      'postcss-plugin-nobody-installed.',
      'postcss-second-missing-plugin.'
    ])
  }, 120_000)

  it('says it again in the next build of the same project', async () => {
    const root = project(
      "module.exports = {plugins: {'postcss-plugin-nobody-installed': {}}}\n"
    )
    const spies = [
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    ]

    await build(root, 'chrome')
    await build(root, 'chrome')

    expect(printed(spies, "Couldn't resolve the PostCSS plugin")).toHaveLength(
      2
    )
  }, 120_000)

  it('names a config whose plugins PostCSS cannot take once', async () => {
    const root = project("module.exports = {plugins: 'nope'}\n")
    const spies = [
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {})
    ]

    // The loader reads that config again and fails the build over it.
    await build(root, 'chrome').catch(() => undefined)

    expect(
      printed(spies, 'PostCSS expects an array or an object')
    ).toHaveLength(1)
  }, 120_000)
})
