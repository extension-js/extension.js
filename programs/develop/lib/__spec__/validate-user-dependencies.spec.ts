import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {assertNoManagedDependencyConflicts} from '../validate-user-dependencies'

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return dir
}

describe('assertNoManagedDependencyConflicts', () => {
  it('throws when user config imports a managed dependency (never process.exit — library hosts embed this path)', () => {
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

    expect(() =>
      assertNoManagedDependencyConflicts(pkgPath, project)
    ).toThrowError(/pintor/)

    try {
      fs.rmSync(project, {recursive: true, force: true})
    } catch {}
  })

  it('does not throw when a managed dependency is only mentioned in a comment', () => {
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

    expect(() =>
      assertNoManagedDependencyConflicts(pkgPath, project)
    ).not.toThrow()

    try {
      fs.rmSync(project, {recursive: true, force: true})
    } catch {}
  })

  it('does not throw when a managed name is only a substring of another package', () => {
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

    expect(() =>
      assertNoManagedDependencyConflicts(pkgPath, project)
    ).not.toThrow()

    try {
      fs.rmSync(project, {recursive: true, force: true})
    } catch {}
  })
})
