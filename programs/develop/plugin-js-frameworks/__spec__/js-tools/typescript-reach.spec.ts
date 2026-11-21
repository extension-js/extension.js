import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {ensureTypeScriptConfig} from '../../js-tools/typescript'
import {buildReachesTypeScript} from '../../js-tools/typescript-reach'
import {writeProjectFiles} from '../../../__spec__/helpers/extension-project'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, {recursive: true, force: true})
  }
})

function createProject(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ts-reach-'))
  tempDirs.push(dir)

  writeProjectFiles(dir, files)

  return dir
}

const reaches = (dir: string, manifest = 'manifest.json') =>
  buildReachesTypeScript({
    projectRoot: dir,
    manifestPath: path.join(dir, manifest),
    browser: 'chrome'
  })

const manifest = (fields: Record<string, unknown>) =>
  JSON.stringify({
    manifest_version: 3,
    name: 'reach',
    version: '1.0',
    ...fields
  })

const STRAY = {
  'icons/icons.ts': 'export const icons: Record<string, string> = {}\n',
  'icons/icons.d.ts': 'export declare const icons: Record<string, string>\n'
}

describe('a TypeScript file the build never compiles', () => {
  it('writes nothing into a built JavaScript extension that holds one', () => {
    const dir = createProject({
      'manifest.json': manifest({
        background: {service_worker: 'background.js'},
        action: {default_popup: 'popup.html'}
      }),
      'background.js': 'import "./lib/helper.js"\n',
      'lib/helper.js': 'export const ready = true\n',
      'popup.html': '<script src="./popup.js"></script>',
      'popup.js': 'console.log("popup")\n',
      ...STRAY
    })
    const before = fs.readdirSync(dir).sort()

    expect(reaches(dir)).toBe(false)

    ensureTypeScriptConfig(dir, {
      manifestPath: path.join(dir, 'manifest.json'),
      browser: 'chrome'
    })

    expect(fs.readdirSync(dir).sort()).toEqual(before)
  })

  it('writes nothing for a src layout whose only TypeScript is unreferenced', () => {
    const dir = createProject({
      'package.json': '{"name": "extension"}',
      'src/manifest.json': manifest({
        content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
      }),
      'src/content.js': 'console.log("content")\n',
      'src/notes/draft.ts': 'export const draft: number = 1\n'
    })

    ensureTypeScriptConfig(dir, {
      manifestPath: path.join(dir, 'src/manifest.json'),
      browser: 'chrome'
    })

    ensureTypeScriptConfig(path.join(dir, 'src'), {
      manifestPath: path.join(dir, 'src/manifest.json'),
      browser: 'chrome'
    })

    expect(fs.existsSync(path.join(dir, 'tsconfig.json'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'src/tsconfig.json'))).toBe(false)
  })

  it('leaves an entry of another browser out of this build', () => {
    const dir = createProject({
      'manifest.json': manifest({
        'chromium:background': {service_worker: 'background.js'},
        'firefox:background': {scripts: ['background.ts']}
      }),
      'background.js': 'console.log("chromium")\n',
      'background.ts': 'export const gecko: boolean = true\n'
    })

    expect(reaches(dir)).toBe(false)

    expect(
      buildReachesTypeScript({
        projectRoot: dir,
        manifestPath: path.join(dir, 'manifest.json'),
        browser: 'firefox'
      })
    ).toBe(true)
  })
})

describe('TypeScript the build compiles', () => {
  it('scaffolds for a script the manifest names', () => {
    const dir = createProject({
      'manifest.json': manifest({
        background: {service_worker: 'background.ts'}
      }),
      'background.ts': 'export const ready: boolean = true\n'
    })

    expect(reaches(dir)).toBe(true)

    ensureTypeScriptConfig(dir, {
      manifestPath: path.join(dir, 'manifest.json'),
      browser: 'chrome'
    })

    expect(fs.existsSync(path.join(dir, 'tsconfig.json'))).toBe(true)
  })

  it('finds a content script and a script a page loads', () => {
    expect(
      reaches(
        createProject({
          'manifest.json': manifest({
            content_scripts: [
              {matches: ['<all_urls>'], js: ['content/main.tsx']}
            ]
          }),
          'content/main.tsx': 'export const ready: boolean = true\n'
        })
      )
    ).toBe(true)

    expect(
      reaches(
        createProject({
          'manifest.json': manifest({
            action: {default_popup: 'popup/index.html'}
          }),
          'popup/index.html': '<script type="module" src="./main.ts"></script>',
          'popup/main.ts': 'export const ready: boolean = true\n'
        })
      )
    ).toBe(true)

    expect(
      reaches(
        createProject({
          'manifest.json': manifest({options_ui: {page: 'options.html'}}),
          'options.html': '<script src="/scripts/options.ts"></script>',
          'scripts/options.ts': 'export const ready: boolean = true\n'
        })
      )
    ).toBe(true)
  })

  it('follows relative imports out of a JavaScript entry', () => {
    expect(
      reaches(
        createProject({
          'manifest.json': manifest({
            background: {service_worker: 'background.js'}
          }),
          'background.js': 'import {a} from "./lib/a"\nconsole.log(a)\n',
          'lib/a.js': 'export {a} from "./b.js"\n',
          'lib/b.ts': 'export const a: number = 1\n'
        })
      )
    ).toBe(true)

    expect(
      reaches(
        createProject({
          'manifest.json': manifest({
            background: {service_worker: 'background.js'}
          }),
          'background.js': 'const load = () => import("./feature")\nload()\n',
          'feature/index.ts': 'export const on: boolean = true\n'
        })
      )
    ).toBe(true)
  })

  it('finds a page and a script in the special folders', () => {
    expect(
      reaches(
        createProject({
          'package.json': '{"name": "extension"}',
          'manifest.json': manifest({}),
          'pages/welcome.html': '<script src="./welcome.ts"></script>',
          'pages/welcome.ts': 'export const ready: boolean = true\n'
        })
      )
    ).toBe(true)

    expect(
      reaches(
        createProject({
          'package.json': '{"name": "extension"}',
          'manifest.json': manifest({}),
          'scripts/injected.ts': 'export const ready: boolean = true\n'
        })
      )
    ).toBe(true)
  })

  it('finds a single file component written in TypeScript', () => {
    expect(
      reaches(
        createProject({
          'manifest.json': manifest({action: {default_popup: 'popup.html'}}),
          'popup.html': '<script type="module" src="./main.js"></script>',
          'main.js': 'import App from "./App.vue"\nconsole.log(App)\n',
          'App.vue':
            '<script setup lang="ts">\nconst n: number = 1\n</script>\n'
        })
      )
    ).toBe(true)
  })

  it('keeps the folder scan when the manifest cannot be read', () => {
    const dir = createProject({
      'manifest.json': '{ not json',
      'background.ts': 'export const ready: boolean = true\n'
    })

    expect(reaches(dir)).toBe(true)
    expect(reaches(dir, 'missing/manifest.json')).toBe(true)
  })

  it('leaves a project with a tsconfig of its own as it was', () => {
    const dir = createProject({
      'manifest.json': manifest({
        background: {service_worker: 'background.js'}
      }),
      'background.js': 'console.log("plain")\n',
      'tsconfig.json': '{"compilerOptions": {"strict": true}}',
      ...STRAY
    })

    ensureTypeScriptConfig(dir, {
      manifestPath: path.join(dir, 'manifest.json'),
      browser: 'chrome'
    })

    expect(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8')).toBe(
      '{"compilerOptions": {"strict": true}}'
    )
  })
})
