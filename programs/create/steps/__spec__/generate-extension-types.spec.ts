import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {renderExtensionEnvTypes} from '../../../develop/lib/extension-env-template'
import {generateExtensionTypes} from '../generate-extension-types'

const created: string[] = []

afterEach(() => {
  for (const dir of created) {
    try {
      fs.rmSync(dir, {recursive: true, force: true})
    } catch {
      // Ignore
    }
  }

  created.length = 0
})

const silentLogger = {log() {}, error() {}}

describe('create generate-extension-types', () => {
  it('writes the same extension-env.d.ts the develop generator emits', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-create-types-'))
    created.push(root)
    const projectPath = path.join(root, 'my-extension')

    await generateExtensionTypes(projectPath, 'my-extension', silentLogger)

    const content = fs.readFileSync(
      path.join(projectPath, 'extension-env.d.ts'),
      'utf8'
    )
    expect(content).toBe(renderExtensionEnvTypes())
    expect(content).toContain('/// <reference types="extension/types" />')
    expect(content).toContain(
      '/// <reference types="extension/types/polyfill" />'
    )

    expect(content).not.toContain('declare module')
  })

  it('keeps @types/chrome for a scaffold whose package.json lists it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-create-types-'))
    created.push(root)
    const projectPath = path.join(root, 'my-extension')
    fs.mkdirSync(projectPath, {recursive: true})
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({devDependencies: {'@types/chrome': '^0.0.287'}})
    )

    await generateExtensionTypes(projectPath, 'my-extension', silentLogger)

    const content = fs.readFileSync(
      path.join(projectPath, 'extension-env.d.ts'),
      'utf8'
    )
    expect(content).toBe(
      renderExtensionEnvTypes(undefined, {}, {ownChromeTypes: true})
    )

    expect(content).toContain(
      '/// <reference types="extension/types/legacy" />'
    )

    expect(content).toContain('/// <reference types="chrome" />')
  })
})
