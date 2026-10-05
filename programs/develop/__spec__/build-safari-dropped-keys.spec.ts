import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function stripAnsi(value: string): string {
  return value.replace(ANSI, '')
}

function project(name: string, manifest: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `extjs-${name}-`))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name, version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')

  for (const page of ['panel', 'sbx', 'popup', 'start']) {
    fs.writeFileSync(
      path.join(root, `${page}.html`),
      `<!doctype html><title>${page}</title><script src="./${page}.js"></script>`
    )

    fs.writeFileSync(path.join(root, `${page}.js`), `console.log("${page}")\n`)
  }

  fs.writeFileSync(path.join(root, 'api.js'), 'console.log("api")\n')

  for (const icon of ['side.png', 'omni.png', 'fav.png']) {
    fs.writeFileSync(path.join(root, icon), 'png')
  }

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      manifest_version: 3,
      background: {service_worker: 'background.js'},
      ...manifest
    })
  )

  return root
}

function listFiles(dir: string, base = dir): string[] {
  return fs
    .readdirSync(dir, {withFileTypes: true})
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)

      return entry.isDirectory()
        ? listFiles(full, base)
        : [path.relative(base, full).split(path.sep).join('/')]
    })
    .sort()
}

async function build(root: string, browser: 'chrome' | 'safari') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalLog = console.log
  const originalWarn = console.warn
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.warn = (...args: unknown[]) => lines.push(args.join(' '))

  try {
    const summary = await extensionBuild(root, {
      browser,
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)

    expect(summary.errors_count).toBe(0)
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', browser)

  return {
    manifest: JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    ),
    files: listFiles(distDir),
    output: stripAnsi(lines.join('\n'))
  }
}

describe('a safari build ships nothing for the keys its filter drops', () => {
  const sidePanelAndSandbox = {
    side_panel: {default_path: 'panel.html'},
    sandbox: {pages: ['sbx.html']}
  }

  it('emits no page for a dropped side_panel or sandbox key', async () => {
    const root = project('safaridropped', sidePanelAndSandbox)
    const {manifest, files, output} = await build(root, 'safari')

    expect(manifest).not.toHaveProperty('side_panel')
    expect(manifest).not.toHaveProperty('sandbox')
    expect(files).toEqual(['background/service_worker.js', 'manifest.json'])
    expect(output).toContain('side_panel Safari has no side panel surface')
    expect(output).toContain(
      'Safari has no support for 2 manifest keys this project declares, so the safari build dropped them.'
    )
  }, 180_000)

  it('drops sidebar_action by name and emits neither its page nor its icon', async () => {
    const root = project('safarisidebar', {
      sidebar_action: {
        default_panel: 'panel.html',
        default_icon: 'side.png',
        default_title: 'Side'
      }
    })
    const {manifest, files, output} = await build(root, 'safari')

    expect(manifest).not.toHaveProperty('sidebar_action')
    expect(manifest).not.toHaveProperty('side_panel')
    expect(files).toEqual(['background/service_worker.js', 'manifest.json'])
    expect(output).toContain('sidebar_action Safari has no sidebar surface')
    expect(output).toContain(
      'Safari has no support for 1 manifest key this project declares, so the safari build dropped it.'
    )

    expect(output).not.toContain('Chromium manifest')
  }, 180_000)

  it('emits no script, icon or startup page for the other dropped keys', async () => {
    const root = project('safariothers', {
      action: {default_popup: 'popup.html'},
      user_scripts: {api_script: 'api.js'},
      omnibox: {keyword: 'go', default_icon: {'16': 'omni.png'}},
      chrome_settings_overrides: {
        startup_pages: ['start.html'],
        search_provider: {
          name: 's',
          keyword: 's',
          search_url: 'https://example.com/?q={searchTerms}',
          favicon_url: 'fav.png'
        }
      }
    })
    const {files} = await build(root, 'safari')

    expect(files).toEqual([
      'action/index.html',
      'action/index.js',
      'background/service_worker.js',
      'manifest.json'
    ])
  }, 180_000)

  it('still emits both pages for the chromium build of the same source', async () => {
    const root = project('chromekept', sidePanelAndSandbox)
    const {manifest, files} = await build(root, 'chrome')

    expect(manifest.side_panel).toEqual({default_path: 'sidebar/index.html'})
    expect(manifest.sandbox).toEqual({pages: ['sandbox/page-0.html']})
    expect(files).toContain('sidebar/index.html')
    expect(files).toContain('sandbox/page-0.html')
  }, 180_000)
})
