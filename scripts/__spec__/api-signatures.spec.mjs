import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  publishedEntries,
  reportDeclarationFile,
  reportEntry
} from '../lib/api-signatures.mjs'

/** @param {Record<string, string>} files */
function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-api-signatures-'))

  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
    fs.writeFileSync(path.join(root, name), text)
  }

  return root
}

test('reads the typed entries of an exports map and where each comes from', () => {
  const root = tree({
    'pkg/package.json': JSON.stringify({
      exports: {
        '.': {types: './dist/module.d.ts', import: './dist/module.mjs'},
        './sub': {types: './dist/pkg/sub/index.d.ts'},
        './types': {types: './types/index.d.ts'},
        './files/*': './dist/files/*',
        './package.json': './package.json'
      }
    }),
    'pkg/module.ts': '',
    'pkg/sub/index.ts': '',
    'pkg/types/index.d.ts': ''
  })

  try {
    assert.deepEqual(publishedEntries(path.join(root, 'pkg')), [
      {subpath: '.', source: 'module.ts', declarationFile: false},
      {subpath: './sub', source: 'sub/index.ts', declarationFile: false},
      {subpath: './types', source: 'types/index.d.ts', declarationFile: true}
    ])
  } finally {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

test('refuses an entry whose declarations have no source file', () => {
  const root = tree({
    'pkg/package.json': JSON.stringify({
      exports: {'.': {types: './dist/gone.d.ts'}}
    })
  })

  try {
    assert.throws(
      () => publishedEntries(path.join(root, 'pkg')),
      /\. of pkg has no source for \.\/dist\/gone\.d\.ts/
    )
  } finally {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

test('prints each export where it is declared, with what the signature reaches', () => {
  const root = tree({
    'pkg/entry.d.ts': [
      "import type { Options as BuildOptions } from './lib/options';",
      "export { run } from './lib/run.js';",
      "export * from './lib/names';",
      'export declare const load: (options: BuildOptions) => Promise<import("./lib/result").Result>;',
      'export type { BuildOptions };',
      ''
    ].join('\r\n'),
    'pkg/lib/options.d.ts': [
      "import type { Compiler } from '@rspack/core';",
      'export interface Options {',
      '    mode: Mode;',
      '    compiler?: Compiler;',
      '}',
      "type Mode = 'development' | 'production';",
      'export declare function unused(): void;',
      ''
    ].join('\n'),
    'pkg/lib/run.d.ts':
      'export declare function run(path: string): void;\nexport declare function run(path: string, force: boolean): void;\n',
    'pkg/lib/names.d.ts': 'export declare const NAME = "pkg";\n',
    'pkg/lib/result.d.ts': 'export interface Result {\n    ok: boolean;\n}\n'
  })

  try {
    assert.equal(
      reportEntry(root, 'pkg/entry.d.ts'),
      [
        '# exports',
        'BuildOptions = pkg/lib/options#Options',
        'NAME = pkg/lib/names#NAME',
        'load = pkg/entry#load',
        'run = pkg/lib/run#run',
        '',
        '# from other packages',
        '@rspack/core#Compiler',
        '',
        '# declarations',
        '',
        '## pkg/entry#load',
        'declare const load: (options: BuildOptions) => Promise<import("pkg/lib/result").Result>;',
        '',
        '## pkg/lib/names#NAME',
        'declare const NAME = "pkg";',
        '',
        '## pkg/lib/options#Mode',
        "type Mode = 'development' | 'production';",
        '',
        '## pkg/lib/options#Options',
        'interface Options {',
        '    mode: Mode;',
        '    compiler?: Compiler;',
        '}',
        '',
        '## pkg/lib/result#Result',
        'interface Result {',
        '    ok: boolean;',
        '}',
        '',
        '## pkg/lib/run#run',
        'declare function run(path: string): void;',
        'declare function run(path: string, force: boolean): void;'
      ].join('\n')
    )
  } finally {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

test('stops at a statement it cannot read instead of leaving it out', () => {
  const root = tree({'pkg/entry.d.ts': 'export = thing;\n'})

  try {
    assert.throws(
      () => reportEntry(root, 'pkg/entry.d.ts'),
      /a declaration statement the report cannot read:\nexport = thing;/
    )
  } finally {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

test('prints a hand-written entry with the files it references, comments out', () => {
  const root = tree({
    'types/index.d.ts': [
      '// Types for a project.',
      '/// <reference types="node" />',
      '/// <reference path="./env.d.ts" />',
      '/// <reference path="./enums.d.ts" />',
      '',
      'export {}',
      ''
    ].join('\r\n'),
    'types/env.d.ts':
      'declare global {\n  /** The mode. */\n  type Mode = "a" | "b"\n}\n',
    'types/enums.d.ts':
      '// Generated by scripts/generate-enum-types.mjs from somewhere.\ndeclare const A: 1\n'
  })

  try {
    assert.equal(
      reportDeclarationFile(root, 'types/index.d.ts'),
      [
        '## types/enums.d.ts',
        'generated by scripts/generate-enum-types.mjs',
        '',
        '## types/env.d.ts',
        'declare global {',
        '  type Mode = "a" | "b"',
        '}',
        '',
        '## types/index.d.ts',
        '/// <reference types="node" />',
        '/// <reference path="./env.d.ts" />',
        '/// <reference path="./enums.d.ts" />',
        'export {}'
      ].join('\n')
    )
  } finally {
    fs.rmSync(root, {recursive: true, force: true})
  }
})
