import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A chunk a content script loads through import() is fetched by the page
// from the extension origin, so the built manifest must list it as web
// accessible for that script's matches, in production as well as in dev.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project(manifestVersion: 2 | 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dyn-import-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'dyn', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'greet.js'),
    'export const greet = () => "DYN_GREETING"\n'
  )
  fs.writeFileSync(
    path.join(root, 'content.js'),
    'export default async function main() {\n  const {greet} = await import("./greet.js")\n  console.log(greet())\n}\n'
  )
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: manifestVersion,
      name: 'dyn',
      version: '1.0.0',
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content.js']}
      ],
      ...(manifestVersion === 2
        ? {browser_specific_settings: {gecko: {id: 'dyn@example.com'}}}
        : {})
    })
  )
  return root
}

async function build(
  root: string,
  browser: 'chrome' | 'firefox',
  mode: 'production' | 'development'
) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    const summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  const distDir = path.join(root, 'dist', browser)
  const files = fs.readdirSync(distDir, {recursive: true}).map(String)
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  )
  const entries: string[] = manifest.content_scripts[0].js
  const chunk = files.find(
    (file) =>
      file.endsWith('.js') &&
      !entries.includes(file) &&
      fs.readFileSync(path.join(distDir, file), 'utf8').includes('DYN_GREETING')
  )
  return {manifest, files, chunk}
}

function warCovers(
  manifest: {manifest_version: number; web_accessible_resources?: unknown},
  file: string
) {
  const war = manifest.web_accessible_resources
  const covers = (pattern: string) =>
    pattern === file ||
    (pattern.includes('*') &&
      new RegExp(
        `^${pattern
          .replace(/[.+^${}()|\\]/g, '\\$&')
          .split('*')
          .join('.*')}$`
      ).test(file))
  if (manifest.manifest_version === 3) {
    return (
      war as Array<{resources: string[]; matches: string[]}> | undefined
    )?.some(
      (group) =>
        group.resources.some(covers) &&
        group.matches.includes('https://example.com/*')
    )
  }
  return (war as string[] | undefined)?.some(covers)
}

describe('a content script chunk loaded through import()', () => {
  for (const manifestVersion of [3, 2] as const) {
    const browser = manifestVersion === 3 ? 'chrome' : 'firefox'
    it(`MV${manifestVersion} production: the chunk ships and is web accessible for the script's matches`, async () => {
      const built = await build(project(manifestVersion), browser, 'production')
      expect(built.chunk, built.files.join(',')).toBeDefined()
      expect(
        warCovers(built.manifest, String(built.chunk)),
        JSON.stringify(built.manifest.web_accessible_resources)
      ).toBe(true)
    }, 180_000)
  }
})
