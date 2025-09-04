import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {extensionBuild} from '../../../../../../programs/develop/dist/module.js'

const fx = (demo: string) =>
  path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'examples', demo)

async function buildOnce(projectRoot: string) {
  await extensionBuild(projectRoot, {
    browser: 'chrome',
    silent: true,
    exitOnError: false as any
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('Timeout waiting for condition')
}

function readLatestCss(outDir: string): string {
  const dir = path.join(outDir, 'content_scripts')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
  if (!files.length) throw new Error('No CSS emitted in content_scripts/')
  // Pick newest by mtime
  const newest = files
    .map((f) => ({f, t: fs.statSync(path.join(dir, f)).mtimeMs}))
    .sort((a, b) => b.t - a.t)[0].f
  return fs.readFileSync(path.join(dir, newest), 'utf8')
}

function readContentJs(outDir: string): string {
  const dir = path.join(outDir, 'content_scripts')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
  if (!files.length) throw new Error('No JS emitted in content_scripts/')
  // content-0.js or similar; pick the first deterministically
  const contentFile = files.sort()[0]
  return fs.readFileSync(path.join(dir, contentFile), 'utf8')
}

describe('integration: rebuild behavior (JS, CSS, CSS imports)', () => {
  const sourceFixture = fx('content')
  let suiteRoot: string
  let out: string

  beforeAll(async () => {
    suiteRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'ext-rebuild-')
    )
    await fs.promises.cp(sourceFixture, suiteRoot, {recursive: true})
    out = path.resolve(suiteRoot, 'dist', 'chrome')
    await buildOnce(suiteRoot)
    await waitFor(() => fs.existsSync(path.join(out, 'manifest.json')))
  }, 60000)

  afterAll(async () => {
    if (suiteRoot && fs.existsSync(suiteRoot)) {
      await fs.promises.rm(suiteRoot, {recursive: true, force: true})
    }
  })

  it('JS changes produce a different content bundle', async () => {
    const beforeJs = readContentJs(out)

    const jsPath = path.join(suiteRoot, 'content', 'scripts.js')
    const original = await fs.promises.readFile(jsPath, 'utf8')
    const edited = original.replace(
      'hello from content_scripts',
      'hello from content_scripts (edited)'
    )
    await fs.promises.writeFile(jsPath, edited, 'utf8')

    await buildOnce(suiteRoot)
    const afterJs = readContentJs(out)
    expect(afterJs).not.toEqual(beforeJs)

    // revert
    await fs.promises.writeFile(jsPath, original, 'utf8')
  }, 60000)

  it('CSS file edits are reflected in emitted CSS', async () => {
    const stylePath = path.join(suiteRoot, 'content', 'styles.css')
    const original = await fs.promises.readFile(stylePath, 'utf8')

    const injectedRule = '.content_script{outline:1px solid red}'
    await fs.promises.writeFile(
      stylePath,
      original + '\n' + injectedRule,
      'utf8'
    )

    await buildOnce(suiteRoot)
    const cssOut = readLatestCss(out)
    // Minifier may strip comments; assert on the actual rule presence
    expect(cssOut.replace(/\s+/g, '')).toContain(
      '.content_script{outline:1pxsolidred}'
    )

    // revert
    await fs.promises.writeFile(stylePath, original, 'utf8')
  }, 60000)

  it('Adding a CSS import changes emitted CSS output', async () => {
    const scriptsPath = path.join(suiteRoot, 'content', 'scripts.js')
    const original = await fs.promises.readFile(scriptsPath, 'utf8')

    const anotherCssPath = path.join(suiteRoot, 'content', 'another.css')
    await fs.promises.writeFile(anotherCssPath, '.another{color:#f00}', 'utf8')

    // If file already imports './styles.css', append after it; otherwise add at top
    const injected = original.includes("import './styles.css'")
      ? original.replace(
          "import './styles.css'",
          "import './styles.css'\nimport './another.css'"
        )
      : "import './another.css'\n" + original
    await fs.promises.writeFile(scriptsPath, injected, 'utf8')

    await buildOnce(suiteRoot)
    const cssOut = readLatestCss(out)
    // Allow minifier to convert #f00 to red (or #ff0000)
    expect(cssOut).toMatch(/\.another\s*\{\s*color:\s*(#f00|#ff0000|red)/i)

    // cleanup: remove import and file
    await fs.promises.writeFile(scriptsPath, original, 'utf8')
    await fs.promises.rm(anotherCssPath, {force: true})
  }, 60000)
})
