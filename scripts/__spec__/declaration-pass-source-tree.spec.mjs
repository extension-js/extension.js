import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {fileURLToPath} from 'node:url'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

const typescriptRoot = path.join(root, 'node_modules', 'typescript')
const typescriptBin = path.join(
  typescriptRoot,
  JSON.parse(fs.readFileSync(path.join(typescriptRoot, 'package.json'), 'utf8'))
    .bin.tsc
)

const programs = fs
  .readdirSync(path.join(root, 'programs'))
  .filter((name) =>
    fs.existsSync(path.join(root, 'programs', name, 'tsconfig.json'))
  )
  .sort()

function listDeclarations(dir) {
  return fs
    .readdirSync(dir, {recursive: true})
    .map(String)
    .filter((entry) => entry.endsWith('.d.ts'))
    .map((entry) => entry.split(path.sep).join('/'))
    .sort()
}

function runDeclarationPass(program) {
  const temp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-declaration-pass-'))
  )
  const consumer = path.join(temp, 'consumer')
  const sibling = path.join(temp, 'sibling', 'lib')

  fs.mkdirSync(consumer, {recursive: true})
  fs.mkdirSync(sibling, {recursive: true})
  fs.writeFileSync(
    path.join(sibling, 'zz-probe.ts'),
    "export const zzProbe = 'zz-declaration-probe'\n"
  )

  fs.writeFileSync(
    path.join(consumer, 'entry.ts'),
    "export {zzProbe} from '../sibling/lib/zz-probe'\n"
  )

  fs.writeFileSync(
    path.join(consumer, 'tsconfig.json'),
    JSON.stringify({
      extends: path.join(root, 'programs', program, 'tsconfig.json'),
      compilerOptions: {types: []},
      include: ['.'],
      exclude: ['dist']
    })
  )

  const result = spawnSync(
    process.execPath,
    [
      typescriptBin,
      '--project',
      path.join(consumer, 'tsconfig.json'),
      '--declarationDir',
      path.join(consumer, 'dist'),
      '--noEmit',
      'false',
      '--declaration',
      '--emitDeclarationOnly'
    ],
    {cwd: consumer, encoding: 'utf8'}
  )

  const declarations = listDeclarations(temp)

  fs.rmSync(temp, {recursive: true, force: true})

  return {output: `${result.stdout}\n${result.stderr}`, declarations}
}

test('every program with a tsconfig is covered', () => {
  assert.deepEqual(programs, ['create', 'develop', 'extension', 'install'])
})

for (const program of programs) {
  test(`the ${program} declaration pass writes nothing beside a source outside its root`, () => {
    const {output, declarations} = runDeclarationPass(program)
    const emitted = declarations.filter((entry) =>
      entry.startsWith('consumer/dist/')
    )
    const stray = declarations.filter(
      (entry) => !entry.startsWith('consumer/dist/')
    )

    assert.ok(
      /TS6059|TS5011/.test(output) ||
        emitted.some((entry) => entry.endsWith('zz-probe.d.ts')),
      `the declaration pass never reached the probe:\n${output}`
    )

    assert.deepEqual(
      stray,
      [],
      `programs/${program}/tsconfig.json let a failed declaration pass write beside a source file. Keep noEmitOnError on in every program tsconfig.`
    )
  })
}
