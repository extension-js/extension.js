import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Every path the built manifest names must exist in dist exactly there, for
// each resource kind, wherever the source lives and however it is spelled.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB' +
    'h6FO1AAAAABJRU5ErkJggg==',
  'base64'
)
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(
  manifest: Record<string, unknown>,
  files: Record<string, Buffer | string>
) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extjs-manifest-resource-paths-')
  )
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'resource-paths', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'R',
      version: '1.0.0',
      ...manifest
    })
  )
  for (const [rel, content] of Object.entries(files)) {
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
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  const distDir = path.join(root, 'dist', 'chrome')
  return {
    distDir,
    manifest: JSON.parse(
      fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
    )
  }
}

function expectInDist(distDir: string, declared: unknown) {
  expect(typeof declared).toBe('string')
  const target = path.join(distDir, String(declared))
  expect(
    fs.existsSync(target),
    `manifest names ${declared} but dist lacks it`
  ).toBe(true)
}

describe('theme images', () => {
  for (const spelling of ['public/frame.png', '/frame.png']) {
    it(`under public land where the manifest points (${spelling})`, async () => {
      const root = project(
        {theme: {images: {theme_frame: spelling}, colors: {frame: [1, 2, 3]}}},
        {'public/frame.png': PNG}
      )
      const {distDir, manifest} = await build(root)
      expectInDist(distDir, manifest.theme.images.theme_frame)
    }, 120_000)
  }

  it('outside public keep the canonical theme folder', async () => {
    const root = project(
      {
        theme: {
          images: {theme_frame: 'images/frame.png'},
          colors: {frame: [1, 2, 3]}
        }
      },
      {'images/frame.png': PNG}
    )
    const {distDir, manifest} = await build(root)
    expect(manifest.theme.images.theme_frame).toBe('theme/images/frame.png')
    expectInDist(distDir, manifest.theme.images.theme_frame)
  }, 120_000)
})

describe('omnibox default_icon', () => {
  for (const spelling of ['public/omni.png', '/omni.png']) {
    it(`under public lands where the manifest points (${spelling})`, async () => {
      const root = project(
        {omnibox: {keyword: 'ex', default_icon: spelling}},
        {'public/omni.png': PNG}
      )
      const {distDir, manifest} = await build(root)
      expectInDist(distDir, manifest.omnibox.default_icon)
    }, 120_000)
  }

  it('outside public is emitted at the path the manifest names', async () => {
    const root = project(
      {omnibox: {keyword: 'ex', default_icon: {'16': 'images/omni16.png'}}},
      {'images/omni16.png': PNG}
    )
    const {distDir, manifest} = await build(root)
    expectInDist(distDir, manifest.omnibox.default_icon['16'])
  }, 120_000)
})

describe('sandbox pages', () => {
  it('under public (root-absolute spelling) land where the manifest points', async () => {
    const root = project(
      {sandbox: {pages: ['/sb.html']}},
      {'public/sb.html': '<!doctype html><title>sb</title>'}
    )
    const {distDir, manifest} = await build(root)
    expectInDist(distDir, manifest.sandbox.pages[0])
  }, 120_000)

  it('outside public keep the canonical sandbox names', async () => {
    const root = project(
      {sandbox: {pages: ['pages/sb.html']}},
      {'pages/sb.html': '<!doctype html><title>sb</title>'}
    )
    const {distDir, manifest} = await build(root)
    expect(manifest.sandbox.pages[0]).toBe('sandbox/page-0.html')
    expectInDist(distDir, manifest.sandbox.pages[0])
  }, 120_000)
})
