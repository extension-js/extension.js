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
    expect(content).toContain("declare module '*.png'")
    expect(content).toContain("declare module '*.css'")
  })
})
