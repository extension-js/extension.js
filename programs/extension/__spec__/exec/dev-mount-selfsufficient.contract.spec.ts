import {spawnSync} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

function cliRoot(): string {
  return path.resolve(__dirname, '../..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (existsSync(cjs)) return cjs
  return path.join(cliRoot(), 'dist', 'cli.js')
}

function createFixture(): string {
  const projectDir = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'extjs-mount-guard-'))
  )
  const contentDir = path.join(projectDir, 'content')
  mkdirSync(contentDir, {recursive: true})

  writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'mount-guard-fixture',
      private: true,
      version: '0.0.1'
    }),
    'utf8'
  )
  writeFileSync(
    path.join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Mount Guard Fixture',
      version: '0.0.1',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    }),
    'utf8'
  )
  writeFileSync(
    path.join(contentDir, 'scripts.js'),
    [
      'export default function initial() {',
      "  const root = document.createElement('div')",
      "  root.setAttribute('data-extension-root', 'true')",
      '  document.body.appendChild(root)',
      '  return () => root.remove()',
      '}'
    ].join('\n'),
    'utf8'
  )
  return projectDir
}

function readEmittedContentScript(projectDir: string): string {
  const dir = path.join(projectDir, 'dist', 'chromium', 'content_scripts')
  const file = readdirSync(dir).find(
    (name) => /^content-0.*\.js$/.test(name) && !name.endsWith('.map')
  )
  if (!file) throw new Error(`no emitted content-0 bundle in ${dir}`)
  return readFileSync(path.join(dir, file), 'utf8')
}

describe('content-script self-mount build contract', () => {
  it('a dev build emits a self-mounting content-script bundle (no controller needed)', () => {
    const projectDir = createFixture()

    const result = spawnSync(
      process.execPath,
      [cliBin(), 'build', '--mode', 'development', projectDir],
      {
        cwd: cliRoot(),
        encoding: 'utf8',
        env: {...process.env, EXTENSION_ENV: 'test'}
      }
    )

    expect(
      result.status,
      `build failed:\n${result.stdout}\n${result.stderr}`
    ).toBe(0)

    const bundle = readEmittedContentScript(projectDir)

    expect(bundle).toContain('__EXTENSIONJS_mount(__EXTENSIONJS_default__')
    expect(bundle).toContain('data-extension-root')
  }, 120000)

  it('self-mounts even when the project root is a symlinked path (macOS $TMPDIR / CI temp dirs)', () => {
    const realProject = createFixture()
    const linkRoot = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'extjs-link-'))
    )
    const symlinkedProject = path.join(linkRoot, 'project-link')
    symlinkSync(realProject, symlinkedProject, 'dir')

    const result = spawnSync(
      process.execPath,
      [cliBin(), 'build', '--mode', 'development', symlinkedProject],
      {
        cwd: cliRoot(),
        encoding: 'utf8',
        env: {...process.env, EXTENSION_ENV: 'test'}
      }
    )

    expect(
      result.status,
      `build failed:\n${result.stdout}\n${result.stderr}`
    ).toBe(0)

    const bundle = readEmittedContentScript(symlinkedProject)
    expect(bundle).toContain('__EXTENSIONJS_mount(__EXTENSIONJS_default__')
    expect(bundle).toContain('data-extension-root')
  }, 120000)
})
