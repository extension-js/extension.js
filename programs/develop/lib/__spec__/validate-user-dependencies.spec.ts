import * as fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {assertNoManagedDependencyConflicts} from '../validate-user-dependencies'

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return dir
}

describe('assertNoManagedDependencyConflicts', () => {
  it('throws when user config imports a managed dependency (never process.exit, library hosts embed this path)', () => {
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
    } catch {
      // Ignore
    }
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
    } catch {
      // Ignore
    }
  })

  it('does not throw when a managed name is only a substring of another package', () => {
    const project = makeTempDir('extjs-substring-')
    const pkgPath = path.join(project, 'package.json')
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
    } catch {
      // Ignore
    }
  })
})
