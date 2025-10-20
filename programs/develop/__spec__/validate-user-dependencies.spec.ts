import {describe, it, expect, vi} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import {assertNoManagedDependencyConflicts} from '../develop-lib/validate-user-dependencies'

function makeTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return dir
}

describe('assertNoManagedDependencyConflicts', () => {
  it('exits when user config references a managed dependency', () => {
    const project = makeTempDir('extjs-conflict-')
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
      // do not actually exit the process
      .mockImplementation(((_code?: number) => undefined) as any)

    assertNoManagedDependencyConflicts(pkgPath, project)
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
