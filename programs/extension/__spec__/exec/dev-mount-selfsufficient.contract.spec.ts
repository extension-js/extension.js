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

// REGRESSION GUARD, "the emitted content-script bundle is self-sufficient".
//
// This encodes the resolution of the hmr-no-browser GATE: a content script with
// a default export MUST self-mount from the bundle, independent of the CDP
// controller, so `extension dev --no-browser`, headless/CI, and remote dev all
// run content scripts. The original investigation feared a regression where the
// wrapper loader stops matching the (generated/concat) content-script entry, so
// the emitted bundle never calls __EXTENSIONJS_mount and nothing mounts unless a
// launched-browser controller injects it at runtime.
//
// A loader-level unit test asserts the wrapper emits the mount in isolation
// (content-script-wrapper.spec.ts). This complements it at the BUILD level:
// it runs the real pipeline end-to-end so it also catches "loader not wired to
// the entry". It uses `build --mode development` (unminified, deterministic, no
// browser), production minifies __EXTENSIONJS_mount to a mangled name, which is
// why the build-time grep proxy is only meaningful on a dev build.

function cliRoot(): string {
  return path.resolve(__dirname, '../..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (existsSync(cjs)) return cjs
  return path.join(cliRoot(), 'dist', 'cli.js')
}

function createFixture(): string {
  // realpathSync is load-bearing: mkdtemp returns a symlinked path on macOS
  // ($TMPDIR -> /var/folders, a symlink to /private/var). rspack canonicalizes
  // a module's resource path, so the wrapper rule's `include` dir must be the
  // canonical path too or it won't match and the wrapper won't run. We assert
  // the self-mount, not the symlink-include matching, so canonicalize here.
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
  // A default-export content script, the framework invokes it on injection.
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

    // The wrapper ran on the entry and emitted the call that invokes the user's
    // default export. This is the load-bearing line that makes the bundle
    // controller-independent.
    expect(bundle).toContain('__EXTENSIONJS_mount(__EXTENSIONJS_default__')
    // And the user's default-export body is present (it is what mounts the UI).
    expect(bundle).toContain('data-extension-root')
  }, 120000)

  it('self-mounts even when the project root is a symlinked path (macOS $TMPDIR / CI temp dirs)', () => {
    // Regression for the symlink-include mismatch: rspack hands the loader a
    // canonical resourcePath, but the wrapper rule's `include` and the loader's
    // manifestDir were built from the non-canonical (symlinked) project path, so
    // the content script was not recognized as a declared entry and lost its
    // mount. Build THROUGH a symlink to reproduce the original break.
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
