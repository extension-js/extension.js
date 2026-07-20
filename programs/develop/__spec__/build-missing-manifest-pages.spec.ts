// Real-rspack regression gate for manifest page-surface existence checks
// (G31). Build-time strictness already rejects manifests whose
// background.service_worker / content_scripts / icons point at missing files,
// but page surfaces (action.default_popup, options_page, options_ui.page,
// chrome_url_overrides.*) used to skip silently: the build ended "with no
// warnings" as a manifest-only dist whose rewritten manifest pointed at a
// phantom action/index.html. Chrome refuses to load such an extension, so the
// build must fail it honestly.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const MISSING_POPUP_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-missing-popup-')
)
const MISSING_OVERRIDE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-missing-override-')
)
const PRESENT_POPUP_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'extjs-build-present-popup-')
)

function writePackageJson(root: string, name: string) {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name, version: '0.0.0'}, null, 2)
  )
}

function writeMissingPopupFixture() {
  writePackageJson(MISSING_POPUP_ROOT, 'extjs-build-missing-popup-spec')
  fs.writeFileSync(
    path.join(MISSING_POPUP_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, missing popup + options page',
        version: '1.0.0',
        action: {default_popup: 'popup.html'},
        options_page: 'options.html'
      },
      null,
      2
    )
  )
}

function writeMissingOverrideFixture() {
  writePackageJson(MISSING_OVERRIDE_ROOT, 'extjs-build-missing-override-spec')
  fs.writeFileSync(
    path.join(MISSING_OVERRIDE_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, missing newtab override',
        version: '1.0.0',
        chrome_url_overrides: {newtab: 'newtab.html'}
      },
      null,
      2
    )
  )
}

// Control: the same surfaces with files present must keep building clean.
function writePresentPopupFixture() {
  writePackageJson(PRESENT_POPUP_ROOT, 'extjs-build-present-popup-spec')
  fs.writeFileSync(
    path.join(PRESENT_POPUP_ROOT, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'Build Spec, present popup',
        version: '1.0.0',
        action: {default_popup: 'popup.html'}
      },
      null,
      2
    )
  )
  fs.writeFileSync(
    path.join(PRESENT_POPUP_ROOT, 'popup.html'),
    '<html><body><h1>popup</h1></body></html>\n'
  )
}

async function buildFixture(root: string) {
  const {extensionBuild} = await import('../command-build')

  const previousAuthorMode = process.env.EXTENSION_AUTHOR_MODE
  const previousVitest = process.env.VITEST
  process.env.VITEST = 'true'
  delete process.env.EXTENSION_AUTHOR_MODE

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previousAuthorMode === undefined) {
      delete process.env.EXTENSION_AUTHOR_MODE
    } else {
      process.env.EXTENSION_AUTHOR_MODE = previousAuthorMode
    }
    if (previousVitest === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = previousVitest
    }
  }
}

beforeAll(() => {
  writeMissingPopupFixture()
  writeMissingOverrideFixture()
  writePresentPopupFixture()
}, 30_000)

afterAll(() => {
  fs.rmSync(MISSING_POPUP_ROOT, {recursive: true, force: true})
  fs.rmSync(MISSING_OVERRIDE_ROOT, {recursive: true, force: true})
  fs.rmSync(PRESENT_POPUP_ROOT, {recursive: true, force: true})
})

describe('build: manifest page-surface existence checks (real rspack)', () => {
  // VITEST=true flips extensionBuild's shouldExitOnError to false, so a
  // failed build rejects the promise instead of killing the test process.
  it('fails the build when action.default_popup and options_page point at missing files', async () => {
    await expect(buildFixture(MISSING_POPUP_ROOT)).rejects.toThrow(
      'Build failed with errors'
    )
  }, 120_000)

  it('fails the build when a chrome_url_overrides page is missing', async () => {
    await expect(buildFixture(MISSING_OVERRIDE_ROOT)).rejects.toThrow(
      'Build failed with errors'
    )
  }, 120_000)

  it('keeps building clean when the declared pages exist', async () => {
    const summary = await buildFixture(PRESENT_POPUP_ROOT)
    expect(summary.errors_count).toBe(0)

    const popupDist = path.join(
      PRESENT_POPUP_ROOT,
      'dist',
      'chrome',
      'action',
      'index.html'
    )
    expect(fs.existsSync(popupDist), `missing ${popupDist}`).toBe(true)
  }, 120_000)
})
