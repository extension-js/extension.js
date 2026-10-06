import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-war-pages-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'war-pages',
      version: '0.0.0'
    }),
    ...files
  }

  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
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
    } as never)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function dist(root: string, rel: string) {
  return path.join(root, 'dist', 'chrome', rel)
}

function read(root: string, rel: string) {
  return fs.readFileSync(dist(root, rel), 'utf8')
}

function declaredResources(root: string): string[] {
  const manifest = JSON.parse(read(root, 'manifest.json'))

  return manifest.web_accessible_resources.flatMap(
    (group: {resources: string[]}) => group.resources
  )
}

function page(script: string, body = '') {
  return `<html><body>${body}<script src="${script}"></script></body></html>`
}

describe('a source page listed in web_accessible_resources', () => {
  it('is compiled at its listed path with its TypeScript and stylesheet', async () => {
    const root = project({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'war-pages',
        version: '1.0.0',
        background: {service_worker: 'background.js'},
        web_accessible_resources: [
          {resources: ['frames/frame.html'], matches: ['<all_urls>']}
        ]
      }),
      'background.js': 'console.log("background")',
      'frames/frame.html':
        '<html><head><link rel="stylesheet" href="./frame.css"></head>' +
        '<body><script src="./frame.ts"></script></body></html>',
      'frames/frame.ts':
        'const mark: string = "WAR_FRAME_e41b"\ndocument.title = mark\n',
      'frames/frame.css': '.war-frame-e41b { color: red }\n'
    })

    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(declaredResources(root)).toEqual(['frames/frame.html'])

    const html = read(root, 'frames/frame.html')

    expect(html).not.toContain('frame.ts')
    expect(html).toContain('src="/frames/frame.js"')
    expect(html).toContain('href="/frames/frame.css"')
    expect(read(root, 'frames/frame.js')).toContain('WAR_FRAME_e41b')
    expect(read(root, 'frames/frame.css')).toContain('war-frame-e41b')
  }, 120_000)

  it('is compiled at its listed path when the manifest names it as a surface too', async () => {
    const root = project({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'war-pages',
        version: '1.0.0',
        permissions: ['sidePanel'],
        background: {service_worker: 'background.js'},
        side_panel: {default_path: 'sidebar.html'},
        web_accessible_resources: [
          {resources: ['sidebar.html'], matches: ['<all_urls>']}
        ]
      }),
      'background.js': 'console.log("background")',
      'sidebar.html': page('./sidebar.ts'),
      'sidebar.ts':
        'const mark: string = "WAR_SIDEBAR_77c2"\ndocument.title = mark\n'
    })

    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(declaredResources(root)).toEqual(['sidebar.html'])
    expect(JSON.parse(read(root, 'manifest.json')).side_panel).toEqual({
      default_path: 'sidebar/index.html'
    })

    for (const rel of ['sidebar.html', 'sidebar/index.html']) {
      const html = read(root, rel)
      const scripts = [...html.matchAll(/<script src="\/([^"]+)"/g)].map(
        (match) => match[1]
      )

      expect(html, rel).not.toContain('sidebar.ts')
      expect(scripts.length, rel).toBeGreaterThan(0)
      expect(
        scripts.map((script) => read(root, script)).join('\n'),
        rel
      ).toContain('WAR_SIDEBAR_77c2')
    }
  }, 120_000)

  it('is compiled at its root path when the manifest sits in src', async () => {
    const root = project({
      'src/manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'war-pages',
        version: '1.0.0',
        background: {service_worker: 'background.js'},
        web_accessible_resources: [
          {
            resources: ['../frames/above.html', 'frames/plain.html'],
            matches: ['<all_urls>']
          }
        ]
      }),
      'src/background.js': 'console.log("background")',
      'frames/above.html': page('./above.ts'),
      'frames/above.ts':
        'const mark: string = "WAR_ABOVE_0d5f"\ndocument.title = mark\n',
      'frames/plain.html': page('./plain.ts'),
      'frames/plain.ts':
        'const mark: string = "WAR_PLAIN_b3a9"\ndocument.title = mark\n'
    })

    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(declaredResources(root).sort()).toEqual([
      'frames/above.html',
      'frames/plain.html'
    ])

    expect(read(root, 'frames/above.html')).toContain('src="/frames/above.js"')
    expect(read(root, 'frames/above.js')).toContain('WAR_ABOVE_0d5f')
    expect(read(root, 'frames/plain.html')).toContain('src="/frames/plain.js"')
    expect(read(root, 'frames/plain.js')).toContain('WAR_PLAIN_b3a9')
  }, 120_000)

  it('leaves a page the public folder hosts as it was written', async () => {
    const hosted = page('./prebuilt.js', 'WAR_PUBLIC_6e12')
    const root = project({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'war-pages',
        version: '1.0.0',
        background: {service_worker: 'background.js'},
        web_accessible_resources: [
          {resources: ['static/hosted.html'], matches: ['<all_urls>']}
        ]
      }),
      'background.js': 'console.log("background")',
      'public/static/hosted.html': hosted,
      'public/static/prebuilt.js': 'console.log("prebuilt")'
    })

    const summary = await build(root)

    expect(summary.errors_count).toBe(0)
    expect(declaredResources(root)).toEqual(['static/hosted.html'])
    expect(read(root, 'static/hosted.html')).toBe(hosted)
  }, 120_000)
})
