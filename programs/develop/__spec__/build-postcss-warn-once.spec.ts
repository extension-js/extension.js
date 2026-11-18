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
      // The findings are warnings of the build, which a silent one keeps
      // to itself.
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function consoleSpies() {
  return [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  ]
}

// Every line a console method printed that holds the given text.
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
    const spies = consoleSpies()

    await build(root, browser)

    // The build prints its warnings together, so the names are read from
    // everything it printed.
    expect(
      [
        ...printed(spies, "Couldn't resolve the PostCSS plugin")
          .join('\n')
          .matchAll(/Couldn't resolve the PostCSS plugin (\S+)/g)
      ]
        .map((match) => match[1])
        .sort()
    ).toEqual([
      'postcss-plugin-nobody-installed.',
      'postcss-second-missing-plugin.'
    ])
  }, 120_000)

  // What `build --output json` answers with is this list.
  it('lists each finding once in the warnings the build answers with', async () => {
    const root = project(
      "module.exports = {plugins: {'postcss-plugin-nobody-installed': {}, 'postcss-second-missing-plugin': {}}}\n"
    )

    consoleSpies()

    const summary = (await build(root, 'chrome')) as {
      warnings_count: number
      warnings: string[]
    }

    expect(summary.warnings_count).toBe(2)
    expect(
      summary.warnings
        .map(
          (warning) =>
            /Couldn't resolve the PostCSS plugin (\S+)\./.exec(warning)?.[1]
        )
        .sort()
    ).toEqual([
      'postcss-plugin-nobody-installed',
      'postcss-second-missing-plugin'
    ])
  }, 120_000)

  it('says it again in the next build of the same project', async () => {
    const root = project(
      "module.exports = {plugins: {'postcss-plugin-nobody-installed': {}}}\n"
    )
    const spies = consoleSpies()

    await build(root, 'chrome')
    await build(root, 'chrome')

    expect(printed(spies, "Couldn't resolve the PostCSS plugin")).toHaveLength(
      2
    )
  }, 120_000)
})

function emittedCss(root: string, browser: string) {
  const sheets: string[] = []

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const abs = path.join(dir, entry.name)

      if (entry.isDirectory()) walk(abs)
      else if (entry.name.endsWith('.css')) {
        sheets.push(fs.readFileSync(abs, 'utf8'))
      }
    }
  }

  walk(path.join(root, 'dist', browser))

  return sheets.join('\n')
}

const unusableConfigs = [
  {
    name: 'a config that does not parse',
    config: 'module.exports = {plugins: [\n',
    says: 'Could not load the PostCSS config'
  },
  {
    name: 'a config whose plugins PostCSS cannot take',
    config: "module.exports = {plugins: 'nope'}\n",
    says: 'PostCSS expects an array or an object'
  },
  {
    name: 'a config naming a plugin nobody installed',
    config:
      "module.exports = {plugins: {'postcss-plugin-nobody-installed': {}}}\n",
    says: "Couldn't resolve the PostCSS plugin"
  }
]

// Each of these warnings says the build continues, so the build has to
// finish and ship the sheets the way it would without that config.
describe.each(unusableConfigs)('$name is set aside', ({config, says}) => {
  it.each([
    'chrome',
    'firefox'
  ] as const)('warns once and still ships the styles on %s', async (browser) => {
    const root = project(config)
    const spies = consoleSpies()

    await build(root, browser)

    const css = emittedCss(root, browser)

    expect(css).toContain('.a{color:red}')
    expect(css).toContain('.b{color:#00f}')
    expect(printed(spies, says)).toHaveLength(1)
    expect(printed(spies, 'continue')).toHaveLength(1)
    expect(printed(spies, 'Loading PostCSS')).toEqual([])
  }, 120_000)
})
