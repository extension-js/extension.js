import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {ensureTypeScriptConfig} from '../../js-tools/typescript'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, {recursive: true, force: true})
  }
})

function createProject(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ts-boundary-'))
  tempDirs.push(dir)

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content, 'utf8')
  }

  return dir
}

describe('ensureTypeScriptConfig package boundaries', () => {
  it('ignores TypeScript inside a nested package of a JavaScript extension', () => {
    const projectDir = createProject({
      'package.json': '{"name": "extension"}',
      'manifest.json': '{"manifest_version": 3}',
      'background.js': '',
      'packages/server/package.json': '{"name": "server"}',
      'packages/server/src/index.ts': 'export const port: number = 1\n'
    })

    ensureTypeScriptConfig(projectDir)

    expect(fs.existsSync(path.join(projectDir, 'tsconfig.json'))).toBe(false)
  })

  it('still scaffolds for TypeScript in a plain subfolder', () => {
    const projectDir = createProject({
      'package.json': '{"name": "extension"}',
      'manifest.json': '{"manifest_version": 3}',
      'src/background.ts': 'export const ready: boolean = true\n'
    })

    ensureTypeScriptConfig(projectDir)

    expect(fs.existsSync(path.join(projectDir, 'tsconfig.json'))).toBe(true)
  })
})
