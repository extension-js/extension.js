import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// The env step templates $EXTENSION_PUBLIC_* in emitted .html and .json at
// the same processAssets stage the html step rewrites the page in. The page
// must keep both: the templated values and the injected script tags.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const SHARED_MARK = 'SHARED_MODULE_MARK_51e2'

function project(options: {sharedPages?: boolean} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-html-env-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'html-env', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: '__MSG_name__',
      description: '$EXTENSION_PUBLIC_FOO',
      version: '1.0.0',
      default_locale: 'en',
      action: {default_popup: 'popup.html'},
      ...(options.sharedPages ? {options_ui: {page: 'options.html'}} : {})
    })
  )
  fs.writeFileSync(path.join(root, '.env'), 'EXTENSION_PUBLIC_FOO=envBar\n')
  fs.mkdirSync(path.join(root, '_locales', 'en'), {recursive: true})
  fs.writeFileSync(
    path.join(root, '_locales', 'en', 'messages.json'),
    JSON.stringify({name: {message: 'Name $EXTENSION_PUBLIC_FOO'}})
  )
  fs.writeFileSync(
    path.join(root, 'shared.js'),
    `export function greet(name) {\n  globalThis.__shared = '${SHARED_MARK}'\n  return name + ' ' + '${SHARED_MARK}'\n}\n`
  )
  const pages = options.sharedPages ? ['popup', 'options'] : ['popup']
  for (const page of pages) {
    fs.writeFileSync(
      path.join(root, `${page}.html`),
      `<html><head><title>$EXTENSION_PUBLIC_FOO</title></head><body><div id="root">$EXTENSION_PUBLIC_MODE</div><script type="module" src="./${page}.js"></script></body></html>\n`
    )
    const body = options.sharedPages
      ? `import {greet} from './shared.js'\ndocument.getElementById('root').textContent = greet('${page}')\n`
      : `document.getElementById('root').textContent = '${page}'\n`
    fs.writeFileSync(path.join(root, `${page}.js`), body)
  }
  return root
}

async function build(root: string, mode: 'production' | 'development') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function read(root: string, file: string) {
  return fs.readFileSync(path.join(root, 'dist', 'chrome', file), 'utf8')
}

describe('build: env templating survives the html update step', () => {
  it('templates the popup title and keeps the page script tag (chrome production)', async () => {
    const root = project()
    const summary: any = await build(root, 'production')
    expect(summary.errors_count).toBe(0)

    const html = read(root, 'action/index.html')
    expect(html, html).toContain('<title>envBar</title>')
    expect(html, html).toContain('<div id="root">production</div>')
    expect(html, html).not.toContain('$EXTENSION_PUBLIC_')
    expect(html, html).toMatch(/<script[^>]*src="\/action\/index\.js"/)

    const manifest = JSON.parse(read(root, 'manifest.json'))
    expect(manifest.description).toBe('envBar')
    const messages = JSON.parse(read(root, '_locales/en/messages.json'))
    expect(messages.name.message).toBe('Name envBar')
  }, 120_000)

  it('templates every page that loads a shared sibling chunk', async () => {
    const root = project({sharedPages: true})
    const summary: any = await build(root, 'production')
    expect(summary.errors_count).toBe(0)

    for (const [page, entry] of [
      ['action/index.html', '/action/index.js'],
      ['options/index.html', '/options/index.js']
    ]) {
      const html = read(root, page)
      expect(html, html).toContain('<title>envBar</title>')
      expect(html, html).not.toContain('$EXTENSION_PUBLIC_')
      expect(html, html).toMatch(/<script[^>]*src="\/shared\/commons\.js"/)
      expect(html, html).toContain(`src="${entry}"`)
      expect(html.indexOf('/shared/commons.js'), html).toBeLessThan(
        html.indexOf(entry)
      )
    }
  }, 120_000)

  it('templates the popup title in a development build too', async () => {
    const root = project()
    const summary: any = await build(root, 'development')
    expect(summary.errors_count).toBe(0)

    const html = read(root, 'action/index.html')
    expect(html, html).toContain('<title>envBar</title>')
    expect(html, html).toContain('<div id="root">development</div>')
    expect(html, html).toMatch(/<script[^>]*src="\/action\/index\.js"/)
  }, 120_000)
})
