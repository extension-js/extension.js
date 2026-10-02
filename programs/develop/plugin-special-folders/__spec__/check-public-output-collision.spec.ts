import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {explainPublicOutputCollision} from '../check-public-output-collision'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function publicFolder(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-collide-'))
  roots.push(root)
  const publicDir = path.join(root, 'public')

  for (const file of files) {
    const target = path.join(publicDir, file)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, 'x')
  }

  fs.mkdirSync(publicDir, {recursive: true})

  return publicDir
}

// The real diagnostic arrives styled and indented, which is what broke the
// first attempt at matching it.
function conflict(emitted: string) {
  return {
    message: `  [1m  × [31mConflict[39m: Multiple assets emit different content to the same filename ${emitted}.[22m`
  }
}

function compilationWith(errors: Array<{message: string}>) {
  return {errors} as unknown as Parameters<
    typeof explainPublicOutputCollision
  >[0]
}

describe('naming the public file behind an output collision', () => {
  it('names the file and what to rename', () => {
    const publicDir = publicFolder(['action/index.html'])
    const compilation = compilationWith([conflict('action/index.html')])

    explainPublicOutputCollision(compilation, publicDir)

    expect(compilation.errors).toHaveLength(2)
    const added = compilation.errors[1] as Error & {file?: string}
    expect(added.file).toBe(path.join('public', 'action/index.html'))
    expect(added.message).toContain('action/index.html')
    expect(added.message).toContain('Rename')
  })

  it('stays quiet when the collision is not a public file', () => {
    const publicDir = publicFolder(['img/logo.png'])
    const compilation = compilationWith([conflict('action/index.html')])

    explainPublicOutputCollision(compilation, publicDir)

    expect(compilation.errors).toHaveLength(1)
  })

  it('stays quiet for an unrelated build error', () => {
    const publicDir = publicFolder(['action/index.html'])
    const compilation = compilationWith([
      {message: "Module not found: Can't resolve './missing'"}
    ])

    explainPublicOutputCollision(compilation, publicDir)

    expect(compilation.errors).toHaveLength(1)
  })

  it('stays quiet when the project has no public folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-collide-'))
    roots.push(root)
    const compilation = compilationWith([conflict('action/index.html')])

    explainPublicOutputCollision(compilation, path.join(root, 'public'))

    expect(compilation.errors).toHaveLength(1)
  })

  it('handles a nested collision path', () => {
    const publicDir = publicFolder(['pages/deep/index.html'])
    const compilation = compilationWith([conflict('pages/deep/index.html')])

    explainPublicOutputCollision(compilation, publicDir)

    expect(compilation.errors).toHaveLength(2)
    expect((compilation.errors[1] as Error).message).toContain(
      'pages/deep/index.html'
    )
  })
})
