import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {assertNoManagedDependencyConflicts} from '../validate-user-dependencies'

function createTempProject(packageJson: Record<string, any>): {
  pkgPath: string
  dir: string
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-validate-deps-'))
  const pkgPath = path.join(dir, 'package.json')
  fs.writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2), 'utf-8')
  return {pkgPath, dir}
}

describe('assertNoManagedDependencyConflicts', () => {
  const originalEnv = process.env.EXTENSION_ENV

  beforeEach(() => {
    // Silence console during tests
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Ensure EXTENSION_ENV triggers warnings in dev only when desired
    process.env.EXTENSION_ENV = 'development'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env.EXTENSION_ENV = originalEnv
  })

  it('aborts when user package.json declares a managed dependency and it is referenced in extension.config.js', () => {
    // axios is managed by the develop program (see programs/develop/package.json)
    const {pkgPath, dir} = createTempProject({
      name: 'temp-project',
      version: '1.0.0',
      dependencies: {axios: '1.8.0'}
    })

    // Reference managed dep inside extension.config.js
    fs.writeFileSync(
      path.join(dir, 'extension.config.js'),
      "export default { config: (c) => { c._usesAxios = require('axios'); return c } }",
      'utf-8'
    )

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any)

    assertNoManagedDependencyConflicts(pkgPath, dir)

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect((console.error as any).mock.calls[0]?.[0]).toMatch(
      /managed by .*Extension\.js/i
    )
  })

  it('does not abort when no managed dependency is declared', () => {
    const {pkgPath, dir} = createTempProject({
      name: 'temp-project',
      version: '1.0.0',
      dependencies: {dayjs: '1.11.10'}
    })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('should not exit')
    }) as any)

    expect(() => assertNoManagedDependencyConflicts(pkgPath, dir)).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('does not abort when managed dependency is present but not referenced in extension.config.js', () => {
    const {pkgPath, dir} = createTempProject({
      name: 'temp-project',
      version: '1.0.0',
      dependencies: {axios: '1.8.0'}
    })

    fs.writeFileSync(
      path.join(dir, 'extension.config.js'),
      'export default { config: (c) => c }',
      'utf-8'
    )

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('should not exit')
    }) as any)

    expect(() => assertNoManagedDependencyConflicts(pkgPath, dir)).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
  })
})
