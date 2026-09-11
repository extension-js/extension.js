import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// HTML pages share code by default: the framework runtime lands in
// shared/framework.js and a module two pages import in shared/commons.js.
// Background, content scripts and injected scripts keep one file each.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const REACT_MARK = 'REACT_RUNTIME_MARK_7f3a'
const SHARED_MARK = 'SHARED_MODULE_MARK_9c1d'
const ONLY_POPUP_MARK = 'ONLY_POPUP_MARK_2b8e'

function project(extensionConfig?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-split-default-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'split-default',
      version: '0.0.0',
      dependencies: {react: '0.0.0'}
    })
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'split-default',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      options_ui: {page: 'options.html'},
      background: {service_worker: 'background.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    })
  )
  const reactDir = path.join(root, 'node_modules', 'react')
  fs.mkdirSync(reactDir, {recursive: true})
  fs.writeFileSync(
    path.join(reactDir, 'package.json'),
    JSON.stringify({name: 'react', version: '0.0.0', main: 'index.js'})
  )
  fs.writeFileSync(
    path.join(reactDir, 'index.js'),
    `exports.createElement = function () { globalThis.__react = '${REACT_MARK}'; return '${REACT_MARK}' }\n`
  )
  fs.writeFileSync(
    path.join(root, 'shared.js'),
    `export function greet(name) {\n  globalThis.__shared = '${SHARED_MARK}'\n  return name + ' ' + '${SHARED_MARK}'\n}\n`
  )
  fs.writeFileSync(
    path.join(root, 'only-popup.js'),
    `export function only() {\n  globalThis.__only = '${ONLY_POPUP_MARK}'\n  return '${ONLY_POPUP_MARK}'\n}\n`
  )
  fs.writeFileSync(
    path.join(root, 'theme.css'),
    '.theme-mark { color: rgb(1, 2, 3); }\n'
  )
  for (const page of ['popup', 'options']) {
    fs.writeFileSync(
      path.join(root, `${page}.html`),
      `<html><body><div id="root"></div><script type="module" src="./${page}.js"></script></body></html>\n`
    )
    const onlyImport =
      page === 'popup' ? "import {only} from './only-popup.js'\nonly()\n" : ''
    fs.writeFileSync(
      path.join(root, `${page}.js`),
      `import {createElement} from 'react'\nimport {greet} from './shared.js'\nimport './theme.css'\n${onlyImport}document.getElementById('root').textContent = greet('${page}') + createElement()\n`
    )
  }
  fs.writeFileSync(
    path.join(root, 'background.js'),
    `import {createElement} from 'react'\nimport {greet} from './shared.js'\nconsole.log(greet('background'), createElement())\n`
  )
  fs.writeFileSync(
    path.join(root, 'content.js'),
    `import {createElement} from 'react'\nimport {greet} from './shared.js'\nconsole.log(greet('content'), createElement())\n`
  )
  if (extensionConfig) {
    fs.writeFileSync(path.join(root, 'extension.config.js'), extensionConfig)
  }
  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function read(distDir: string, file: string) {
  return fs.readFileSync(path.join(distDir, file), 'utf8')
}

function scriptSrcs(html: string) {
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1])
}

function contentScriptFile(distDir: string) {
  const manifest = JSON.parse(read(distDir, 'manifest.json'))
  return String(manifest.content_scripts[0].js[0])
}

describe('default page-only split chunks', () => {
  it('shares the framework and the common module between the pages only', async () => {
    const root = project()
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)
    expect(
      (summary.warnings || []).filter((text: string) =>
        text.includes('initial files')
      )
    ).toHaveLength(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const framework = read(distDir, 'shared/framework.js')
    const commons = read(distDir, 'shared/commons.js')
    expect(framework).toContain(REACT_MARK)
    expect(commons).toContain(SHARED_MARK)
    expect(commons).not.toContain(ONLY_POPUP_MARK)
    expect(framework).not.toContain(SHARED_MARK)

    const popup = read(distDir, 'action/index.js')
    const options = read(distDir, 'options/index.js')
    expect(popup).not.toContain(REACT_MARK)
    expect(popup).not.toContain(SHARED_MARK)
    expect(popup).toContain(ONLY_POPUP_MARK)
    expect(options).not.toContain(REACT_MARK)
    expect(options).not.toContain(SHARED_MARK)

    const background = read(distDir, 'background/service_worker.js')
    expect(background).toContain(REACT_MARK)
    expect(background).toContain(SHARED_MARK)

    const content = read(distDir, contentScriptFile(distDir))
    expect(content).toContain(REACT_MARK)
    expect(content).toContain(SHARED_MARK)

    expect(scriptSrcs(read(distDir, 'action/index.html'))).toEqual([
      '/shared/framework.js',
      '/shared/commons.js',
      '/action/index.js'
    ])
    expect(scriptSrcs(read(distDir, 'options/index.html'))).toEqual([
      '/shared/framework.js',
      '/shared/commons.js',
      '/options/index.js'
    ])
    for (const tag of read(distDir, 'action/index.html').match(
      /<script[^>]*>/gi
    ) || []) {
      expect(tag).toContain('type="module"')
    }
  }, 120_000)

  it('keeps a stylesheet two pages import in each page sheet', async () => {
    const root = project()
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    expect(fs.existsSync(path.join(distDir, 'shared', 'commons.css'))).toBe(
      false
    )
    expect(read(distDir, 'action/index.css')).toContain('theme-mark')
    expect(read(distDir, 'options/index.css')).toContain('theme-mark')
  }, 120_000)

  it('restores one file per entry when the user turns splitChunks off', async () => {
    const root = project(
      'module.exports = {config: {optimization: {splitChunks: false}}}\n'
    )
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    expect(fs.existsSync(path.join(distDir, 'shared'))).toBe(false)
    const popup = read(distDir, 'action/index.js')
    expect(popup).toContain(REACT_MARK)
    expect(popup).toContain(SHARED_MARK)
    expect(scriptSrcs(read(distDir, 'action/index.html'))).toEqual([
      '/action/index.js'
    ])
    expect(scriptSrcs(read(distDir, 'options/index.html'))).toEqual([
      '/options/index.js'
    ])
  }, 120_000)
})

// user_scripts.api_script names exactly one file in the manifest, so it is a
// single-file surface: whatever the default groups hoist out of it is lost.
function userScriptProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-split-us-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'split-user-scripts',
      version: '0.0.0',
      dependencies: {react: '0.0.0'}
    })
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'split-user-scripts',
      version: '1.0.0',
      permissions: ['userScripts'],
      action: {default_popup: 'popup.html'},
      options_ui: {page: 'options.html'},
      user_scripts: {api_script: 'api.js'}
    })
  )
  const reactDir = path.join(root, 'node_modules', 'react')
  fs.mkdirSync(reactDir, {recursive: true})
  fs.writeFileSync(
    path.join(reactDir, 'package.json'),
    JSON.stringify({name: 'react', version: '0.0.0', main: 'index.js'})
  )
  fs.writeFileSync(
    path.join(reactDir, 'index.js'),
    `exports.createElement = function () { globalThis.__react = '${REACT_MARK}'; return '${REACT_MARK}' }\n`
  )
  fs.writeFileSync(
    path.join(root, 'shared.js'),
    `export function greet(name) {\n  globalThis.__shared = '${SHARED_MARK}'\n  return name + ' ' + '${SHARED_MARK}'\n}\n`
  )
  for (const page of ['popup', 'options']) {
    fs.writeFileSync(
      path.join(root, `${page}.html`),
      `<html><body><div id="root"></div><script type="module" src="./${page}.js"></script></body></html>\n`
    )
    fs.writeFileSync(
      path.join(root, `${page}.js`),
      `import {createElement} from 'react'\nimport {greet} from './shared.js'\ndocument.getElementById('root').textContent = greet('${page}') + createElement()\n`
    )
  }
  fs.writeFileSync(
    path.join(root, 'api.js'),
    `import {createElement} from 'react'\nimport {greet} from './shared.js'\nconsole.log(greet('api'), createElement())\n`
  )
  return root
}

describe('user_scripts.api_script is a single-file surface', () => {
  it('keeps every module the api script needs inside its own file', async () => {
    const root = userScriptProject()
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const manifest = JSON.parse(read(distDir, 'manifest.json'))
    expect(manifest.user_scripts.api_script).toBe('user_scripts/api_script.js')

    const apiScript = read(distDir, 'user_scripts/api_script.js')
    expect(apiScript).toContain(SHARED_MARK)
    expect(apiScript).toContain(REACT_MARK)

    // The pages still share, so the fixture really does exercise the groups.
    expect(read(distDir, 'shared/commons.js')).toContain(SHARED_MARK)
    expect(read(distDir, 'action/index.js')).not.toContain(SHARED_MARK)
  }, 120_000)
})
