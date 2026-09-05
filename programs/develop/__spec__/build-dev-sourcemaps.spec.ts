import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {decodeSourceMap, originalFor} from './helpers/sourcemap-decode'

// A dev build's emitted maps describe the source the author wrote: the
// original TypeScript, the exact line a token came from, for a wrapped
// content script, each file of a classic multi-file group, the background
// and a page, on both manifest versions.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const CONTENT_TS = [
  'interface Greeting {',
  '  who: string',
  '}',
  'export default function main() {',
  '  const greeting: Greeting = {who: "REPRO_CONTENT_TOKEN"}',
  '  console.log(greeting.who)',
  '}',
  'main()',
  ''
].join('\n')
const CLASSIC_A =
  'interface A {n: number}\nvar a: A = {n: 1}\nconsole.log("CLASSIC_A_TOKEN", a.n)\n'
const CLASSIC_B =
  'interface B {n: number}\nvar b: B = {n: 2}\nconsole.log("CLASSIC_B_TOKEN", b.n)\n'
const BACKGROUND_TS =
  'interface Boot {at: number}\nconst boot: Boot = {at: 1}\nconsole.log("BG_TOKEN", boot.at)\n'
const PAGE_TS =
  'interface Page {id: string}\nconst page: Page = {id: "PAGE_TOKEN"}\ndocument.title = page.id\n'

function project(manifestVersion: 2 | 3) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'extjs-dev-maps-'))
  )
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'maps', version: '0.0.0'})
  )
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({compilerOptions: {strict: true, target: 'ES2020'}})
  )
  fs.mkdirSync(path.join(root, 'lib'))
  fs.mkdirSync(path.join(root, 'pages'))
  fs.writeFileSync(path.join(root, 'content.ts'), CONTENT_TS)
  fs.writeFileSync(path.join(root, 'lib', 'a.ts'), CLASSIC_A)
  fs.writeFileSync(path.join(root, 'lib', 'b.ts'), CLASSIC_B)
  fs.writeFileSync(path.join(root, 'background.ts'), BACKGROUND_TS)
  fs.writeFileSync(path.join(root, 'pages', 'popup.ts'), PAGE_TS)
  fs.writeFileSync(
    path.join(root, 'pages', 'popup.html'),
    '<!doctype html><title>p</title><script src="./popup.ts"></script>'
  )
  const manifest =
    manifestVersion === 3
      ? {
          manifest_version: 3,
          background: {service_worker: 'background.ts'},
          action: {default_popup: 'pages/popup.html'}
        }
      : {
          manifest_version: 2,
          background: {scripts: ['background.ts']},
          browser_action: {default_popup: 'pages/popup.html'}
        }
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      name: 'maps',
      version: '1.0.0',
      ...manifest,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content.ts']},
        {matches: ['<all_urls>'], js: ['lib/a.ts', 'lib/b.ts']}
      ]
    })
  )
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
      mode: 'development',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  const distDir = path.join(root, 'dist', 'chrome')
  const files = fs.readdirSync(distDir, {recursive: true}).map(String)
  const bundles = files.filter((file) => file.endsWith('.js'))
  return {distDir, files, bundles}
}

// Where a token sits in the built output, resolved back through the map.
function resolveToken(distDir: string, bundles: string[], token: string) {
  for (const rel of bundles) {
    const code = fs.readFileSync(path.join(distDir, rel), 'utf8')
    const lines = code.split('\n')
    const generatedLine = lines.findIndex((line) => line.includes(token))
    if (generatedLine < 0) continue
    const mapPath = path.join(distDir, `${rel}.map`)
    expect(fs.existsSync(mapPath), `${rel}.map`).toBe(true)
    const map = decodeSourceMap(fs.readFileSync(mapPath, 'utf8'))
    return {bundle: rel, code, map, original: originalFor(map, generatedLine)}
  }
  throw new Error(`token ${token} not found in any bundle`)
}

const sourceLineOf = (source: string, token: string) =>
  source.split('\n').findIndex((line) => line.includes(token))

function expectResolves(
  distDir: string,
  bundles: string[],
  token: string,
  sourceFile: string,
  sourceText: string
) {
  const hit = resolveToken(distDir, bundles, token)
  expect(hit.original, `${token} in ${hit.bundle}`).not.toBeNull()
  expect(
    hit.original?.source.replace(/^webpack:\/\/[^/]*\//, ''),
    token
  ).toMatch(new RegExp(`${sourceFile.replace('.', '\\.')}$`))
  expect(hit.original?.line, `${token} line`).toBe(
    sourceLineOf(sourceText, token)
  )
  expect(hit.map.sourcesContent.join('\n')).toContain('interface ')
  return hit
}

describe('dev build source maps describe the source', () => {
  it('MV3: content script, classic group files, background and page resolve to their own lines', async () => {
    const {distDir, bundles} = await build(project(3))
    const content = expectResolves(
      distDir,
      bundles,
      'REPRO_CONTENT_TOKEN',
      'content.ts',
      CONTENT_TS
    )
    expect(content.map.sourcesContent.join('\n')).toContain(
      'const greeting: Greeting'
    )
    expectResolves(distDir, bundles, 'CLASSIC_A_TOKEN', 'lib/a.ts', CLASSIC_A)
    expectResolves(distDir, bundles, 'CLASSIC_B_TOKEN', 'lib/b.ts', CLASSIC_B)
    expectResolves(distDir, bundles, 'BG_TOKEN', 'background.ts', BACKGROUND_TS)
    expectResolves(distDir, bundles, 'PAGE_TOKEN', 'pages/popup.ts', PAGE_TS)
  }, 180_000)

  it('MV2: maps resolve the same way and the bundles need no eval', async () => {
    const {distDir, bundles} = await build(project(2))
    expectResolves(
      distDir,
      bundles,
      'REPRO_CONTENT_TOKEN',
      'content.ts',
      CONTENT_TS
    )
    expectResolves(distDir, bundles, 'CLASSIC_B_TOKEN', 'lib/b.ts', CLASSIC_B)
    expectResolves(distDir, bundles, 'BG_TOKEN', 'background.ts', BACKGROUND_TS)
    for (const rel of bundles) {
      const code = fs.readFileSync(path.join(distDir, rel), 'utf8')
      expect(code, rel).not.toMatch(/\beval\(/)
    }
  }, 180_000)
})
