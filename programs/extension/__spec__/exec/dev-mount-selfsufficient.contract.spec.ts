import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

const makeTempFolder = trackTempFolders()

function createFixture(): string {
  const projectDir = realpathSync(makeTempFolder('extjs-mount-guard-'))
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
  it('a dev build emits a self-mounting content-script bundle (no controller needed)', async () => {
    const projectDir = createFixture()

    const result = await runCli(['build', '--mode', 'development', projectDir])

    expect(result.status, `build failed:\n${result.output}`).toBe(0)

    const bundle = readEmittedContentScript(projectDir)

    expect(bundle).toContain('__EXTENSIONJS_mount(__EXTENSIONJS_default__')
    expect(bundle).toContain('data-extension-root')
  }, 120000)

  it('self-mounts even when the project root is a symlinked path (macOS $TMPDIR / CI temp dirs)', async () => {
    const realProject = createFixture()
    const linkRoot = realpathSync(makeTempFolder('extjs-link-'))
    const symlinkedProject = path.join(linkRoot, 'project-link')
    symlinkSync(realProject, symlinkedProject, 'dir')

    const result = await runCli([
      'build',
      '--mode',
      'development',
      symlinkedProject
    ])

    expect(result.status, `build failed:\n${result.output}`).toBe(0)

    const bundle = readEmittedContentScript(symlinkedProject)
    expect(bundle).toContain('__EXTENSIONJS_mount(__EXTENSIONJS_default__')
    expect(bundle).toContain('data-extension-root')
  }, 120000)
})
