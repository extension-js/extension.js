import {describe, it, expect, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {assertNoManagedDependencyConflicts} from '../validate-user-dependencies'

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return dir
}

describe('assertNoManagedDependencyConflicts', () => {
  it('exits when user config imports a managed dependency', () => {
    const project = makeTempDir('extjs-conflict-')
    const pkgPath = path.join(project, 'package.json')
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({dependencies: {pintor: '^0.3.0'}})
    )
    fs.writeFileSync(
      path.join(project, 'extension.config.js'),
      "const p = require('pintor')\nmodule.exports = {config: (c) => c}"
    )

    const exitSpy = vi
      .spyOn(process, 'exit')
      // do not actually exit the process
      .mockImplementation(((_code?: number) => undefined) as any)

    assertNoManagedDependencyConflicts(pkgPath, project)
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()

    try {
      fs.rmSync(project, {recursive: true, force: true})
    } catch {}
  })

  it('does not exit when a managed dependency is only mentioned in a comment', () => {
    const project = makeTempDir('extjs-comment-')
    const pkgPath = path.join(project, 'package.json')
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({dependencies: {pintor: '^0.3.0'}})
    )
    fs.writeFileSync(
      path.join(project, 'extension.config.js'),
      'module.exports = {config: (c) => c, /* pintor */ }'
    )

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => undefined) as any)

    assertNoManagedDependencyConflicts(pkgPath, project)
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()

    try {
      fs.rmSync(project, {recursive: true, force: true})
    } catch {}
  })

  it('does not exit when a managed name is only a substring of another package', () => {
    const project = makeTempDir('extjs-substring-')
    const pkgPath = path.join(project, 'package.json')
    // `pintor` is managed; the project depends on a hypothetical
    // `pintor-extras` and references only that in its config.
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({
        dependencies: {pintor: '^0.3.0', 'pintor-extras': '^1.0.0'}
      })
    )
    fs.writeFileSync(
      path.join(project, 'extension.config.js'),
      "const e = require('pintor-extras')\nmodule.exports = {config: (c) => c}"
    )

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => undefined) as any)

    assertNoManagedDependencyConflicts(pkgPath, project)
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()

    try {
      fs.rmSync(project, {recursive: true, force: true})
    } catch {}
  })
})
