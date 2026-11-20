import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  bindDevSessionRestart,
  DevSessionRestartScheduler,
  requestDevSessionRestart,
  unbindDevSessionRestart
} from '../../../../dev-server/session-restart'
import {listenForManifestChange} from '../../../shared/manifest-change-signal'
import {getAssetsFromHtml} from '../../html-lib/utils'
import {ThrowIfRecompileIsNeeded} from '../../steps/throw-if-recompile-is-needed'

type MakeCompiler = {
  modifiedFiles: Set<string>
  hooks: {
    make: {
      tapAsync: (
        name: string,
        fn: (compilation: any, done: () => void) => void
      ) => void
    }
  }
  runMake: () => void
  _errors: any[]
}

function makeCompiler(modified: string[] = []): MakeCompiler {
  const errors: any[] = []
  let makeHandler: ((compilation: any, done: () => void) => void) | undefined

  const compiler: MakeCompiler = {
    modifiedFiles: new Set(modified),
    hooks: {
      make: {
        tapAsync: (_name, fn) => {
          makeHandler = fn
        }
      }
    },
    runMake() {
      if (!makeHandler) {
        throw new Error('make hook was not registered')
      }

      makeHandler({errors}, () => {})
    },
    _errors: errors
  }

  // The config wires the session to the signal the same way.
  listenForManifestChange(compiler as never, (change) =>
    requestDevSessionRestart(compiler, change)
  )

  return compiler
}

function ensureEntryFiles(dir: string, names: string[]) {
  for (const name of names) {
    const filePath = path.join(dir, name)

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8')
    }
  }
}

function writeHtml(filePath: string, script: string, stylesheet: string) {
  ensureEntryFiles(path.dirname(filePath), [script, stylesheet])
  const html =
    `<html><head><link rel="stylesheet" href="${stylesheet}"></head>` +
    `<body><script src="${script}"></script></body></html>`
  fs.writeFileSync(filePath, html, 'utf8')

  return html
}

function restoreHtmlPreservingStat(
  filePath: string,
  script: string,
  stylesheet: string,
  mtimeSec: number
) {
  const before = fs.statSync(filePath)
  writeHtml(filePath, script, stylesheet)
  fs.utimesSync(filePath, mtimeSec, mtimeSec)
  const after = fs.statSync(filePath)
  expect(after.size).toBe(before.size)
  expect(Math.floor(after.mtimeMs / 1000)).toBe(mtimeSec)
}

describe('ThrowIfRecompileIsNeeded', () => {
  let created = ''
  let tmp = ''

  beforeEach(() => {
    created = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-recompile-'))
    tmp = fs.realpathSync(created)
  })

  afterEach(() => {
    fs.rmSync(created, {recursive: true, force: true})
    unbindDevSessionRestart()
  })

  it('pushes HtmlEntrypointChanged when js/css entries change', () => {
    fs.mkdirSync(tmp, {recursive: true})
    const html = path.join(tmp, 'index.html')
    writeHtml(html, 'a.js', 'a.css')

    const compiler = makeCompiler([html])
    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {page: html}
    } as any).apply(compiler as any)

    writeHtml(html, 'b.js', 'b.css')
    compiler.runMake()

    expect(compiler._errors).toHaveLength(1)
    expect(compiler._errors[0].name).toBe('HtmlEntrypointChanged')
    expect(String(compiler._errors[0].message)).toMatch(
      /Entrypoint references changed/
    )
  })

  it('does not push when entrypoints are unchanged', () => {
    fs.mkdirSync(tmp, {recursive: true})
    const html = path.join(tmp, 'index.html')
    writeHtml(html, 'a.js', 'a.css')

    const compiler = makeCompiler([html])
    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {page: html}
    } as any).apply(compiler as any)

    // Content churn that does not touch script/link entrypoints.
    fs.writeFileSync(
      html,
      '<html><head><link rel="stylesheet" href="a.css"><!-- note --></head>' +
        '<body><script src="a.js"></script></body></html>',
      'utf8'
    )

    compiler.runMake()

    expect(compiler._errors).toHaveLength(0)
  })

  it('still warns when the changed page is not the first path in the rebuild batch', () => {
    fs.mkdirSync(tmp, {recursive: true})
    const other = path.join(tmp, 'styles.css')
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(other, 'body{}', 'utf8')
    writeHtml(html, 'a.js', 'a.css')

    // Batch order: unrelated file first, page second (old code only inspected [0]).
    const compiler = makeCompiler([other, html])
    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {page: html}
    } as any).apply(compiler as any)

    writeHtml(html, 'b.js', 'b.css')
    compiler.runMake()

    expect(compiler._errors).toHaveLength(1)
    expect(compiler._errors[0].name).toBe('HtmlEntrypointChanged')
  })

  it('warns for every page in the batch whose entrypoints changed', () => {
    fs.mkdirSync(tmp, {recursive: true})
    const pageA = path.join(tmp, 'a.html')
    const pageB = path.join(tmp, 'b.html')
    writeHtml(pageA, 'a.js', 'a.css')
    writeHtml(pageB, 'x.js', 'x.css')

    const compiler = makeCompiler([pageA, pageB])
    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {a: pageA, b: pageB}
    } as any).apply(compiler as any)

    writeHtml(pageA, 'a2.js', 'a2.css')
    writeHtml(pageB, 'x2.js', 'x2.css')
    compiler.runMake()

    expect(compiler._errors).toHaveLength(2)
    expect(
      compiler._errors.every((e) => e.name === 'HtmlEntrypointChanged')
    ).toBe(true)
  })

  it('detects entrypoint changes when mtime and size match a prior parse cache entry', () => {
    fs.mkdirSync(tmp, {recursive: true})
    const html = path.join(tmp, 'index.html')
    const frozenMtimeSec = Math.floor(Date.UTC(2020, 0, 1, 12, 0, 0) / 1000)

    writeHtml(html, 'a.js', 'a.css')
    fs.utimesSync(html, frozenMtimeSec, frozenMtimeSec)

    // Prime the shared mtime+size parse cache the way a prior rebuild would.
    const cached = getAssetsFromHtml(html)
    expect(cached.js?.some((p) => p.endsWith(`${path.sep}a.js`))).toBe(true)

    const compiler = makeCompiler([html])
    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {page: html}
    } as any).apply(compiler as any)

    // Backup-style restore: same byte length + restored mtime, different entry.
    restoreHtmlPreservingStat(html, 'b.js', 'b.css', frozenMtimeSec)

    // Disk-cache lookup still returns the primed a.js entry without forced content.
    const staleFromCache = getAssetsFromHtml(html)
    expect(staleFromCache.js?.some((p) => p.endsWith(`${path.sep}a.js`))).toBe(
      true
    )

    expect(staleFromCache.js?.some((p) => p.endsWith(`${path.sep}b.js`))).toBe(
      false
    )

    compiler.runMake()

    expect(compiler._errors).toHaveLength(1)
    expect(compiler._errors[0].name).toBe('HtmlEntrypointChanged')
  })

  it('does not re-read pages that are not in the modified set', () => {
    fs.mkdirSync(tmp, {recursive: true})
    const watched = path.join(tmp, 'watched.html')
    const untouched = path.join(tmp, 'untouched.html')
    writeHtml(watched, 'a.js', 'a.css')
    writeHtml(untouched, 'u.js', 'u.css')

    // Poison the untouched page after the initial snapshot: if make re-read it
    // and compared entrypoints, it would incorrectly warn. Only `watched` is
    // in modifiedFiles, so untouched must stay out of the comparison.
    const compiler = makeCompiler([watched])
    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {watched, untouched}
    } as any).apply(compiler as any)

    writeHtml(watched, 'b.js', 'b.css')
    writeHtml(untouched, 'u2.js', 'u2.css')
    compiler.runMake()

    expect(compiler._errors).toHaveLength(1)
    expect(compiler._errors[0].file).toBe('watched.html')
  })

  it('asks a live session to restart instead of pushing the error', async () => {
    fs.mkdirSync(tmp, {recursive: true})
    const html = path.join(tmp, 'index.html')
    writeHtml(html, 'a.js', 'a.css')
    const compiler = makeCompiler([html])
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)

    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {page: html}
    } as any).apply(compiler as any)

    writeHtml(html, 'b.js', 'b.css')
    compiler.runMake()
    await new Promise((r) => setTimeout(r, 0))

    expect(compiler._errors).toHaveLength(0)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({reason: 'html', pathAfter: html})
    )
  })

  const pageNaming = (...scripts: string[]) =>
    `<html><body>${scripts
      .map((script) => `<script src="${script}"></script>`)
      .join('')}</body></html>`

  it('asks a live session to restart once when a missing page script is created', async () => {
    const html = path.join(tmp, 'index.html')
    const late = path.join(tmp, 'late.js')
    fs.writeFileSync(path.join(tmp, 'a.js'), '')
    fs.writeFileSync(html, pageNaming('a.js', 'late.js'))
    const compiler = makeCompiler()
    const handler = vi.fn()
    const scheduler = new DevSessionRestartScheduler(0)
    scheduler.setHandler(handler)
    bindDevSessionRestart(scheduler)

    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {page: html}
    } as any).apply(compiler as any)

    compiler.runMake()
    await new Promise((r) => setTimeout(r, 0))
    expect(handler).not.toHaveBeenCalled()

    fs.writeFileSync(late, '')
    compiler.runMake()
    compiler.runMake()
    await new Promise((r) => setTimeout(r, 0))

    expect(compiler._errors).toHaveLength(0)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({reason: 'html', pathAfter: late})
    )
  })

  it('says nothing when the page stopped naming the file before it appeared', () => {
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(path.join(tmp, 'a.js'), '')
    fs.writeFileSync(html, pageNaming('a.js', 'late.js'))
    const compiler = makeCompiler([html])

    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {page: html}
    } as any).apply(compiler as any)

    fs.writeFileSync(html, pageNaming('a.js'))
    compiler.runMake()
    fs.writeFileSync(path.join(tmp, 'late.js'), '')
    compiler.runMake()

    expect(compiler._errors).toHaveLength(0)
  })

  it('waits for a file the page started naming after the session began', () => {
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(path.join(tmp, 'a.js'), '')
    fs.writeFileSync(html, pageNaming('a.js'))
    const compiler = makeCompiler([html])

    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {page: html}
    } as any).apply(compiler as any)

    fs.writeFileSync(html, pageNaming('a.js', 'later.js'))
    compiler.runMake()
    expect(compiler._errors).toHaveLength(0)

    // The page itself is not saved again, only the file it waits for.
    compiler.modifiedFiles.clear()
    fs.writeFileSync(path.join(tmp, 'later.js'), '')
    compiler.runMake()
    compiler.runMake()

    expect(compiler._errors).toHaveLength(1)
    expect(compiler._errors[0].name).toBe('HtmlEntrypointChanged')
    expect(compiler._errors[0].file).toBe('index.html')
    expect(String(compiler._errors[0].message)).toContain(
      `FILE ${path.join(tmp, 'later.js')}`
    )
  })

  it('asks once when the page and the file it waited for are saved together', () => {
    const html = path.join(tmp, 'index.html')
    fs.writeFileSync(path.join(tmp, 'a.js'), '')
    fs.writeFileSync(html, pageNaming('a.js', 'late.js'))
    const compiler = makeCompiler([html])

    new ThrowIfRecompileIsNeeded({
      manifestPath: path.join(tmp, 'manifest.json'),
      includeList: {page: html}
    } as any).apply(compiler as any)

    fs.writeFileSync(path.join(tmp, 'late.js'), '')
    fs.writeFileSync(html, `${pageNaming('a.js', 'late.js')}\n`)
    compiler.runMake()

    expect(compiler._errors).toHaveLength(1)
  })
})
