import {describe, it} from 'node:test'
import {RuleTester} from 'eslint'
import local from '../lib/eslint-style-rules.mjs'

// RuleTester reads describe and it from the globals vitest and mocha set,
// node:test exports them instead.
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: {ecmaVersion: 'latest', sourceType: 'module'}
})

tester.run(
  'blank-line-after-shebang',
  local.rules['blank-line-after-shebang'],
  {
    valid: ['#!/usr/bin/env node\n\nrun()\n', 'run()\n'],
    invalid: [
      {
        code: '#!/usr/bin/env node\nrun()\n',
        output: '#!/usr/bin/env node\n\nrun()\n',
        errors: [{message: 'Expected a blank line after the shebang.'}]
      }
    ]
  }
)

tester.run('no-file-header-comment', local.rules['no-file-header-comment'], {
  valid: [
    '// MIT License (c) 2020 the authors\nrun()\n',
    '// eslint-disable-next-line no-console\nconsole.log(1)\n',
    {code: '// █ banner █\nrun()\n', options: [{allowBanner: true}]},
    '#!/usr/bin/env node\n\nrun()\n'
  ],
  invalid: [
    {
      code: '// This file runs things.\n// It has a header.\nrun()\n',
      output: 'run()\n',
      errors: [{message: 'Remove the file header comment.'}]
    },
    {
      code: '// █ banner █\nrun()\n',
      output: 'run()\n',
      errors: [{message: 'Remove the file header comment.'}]
    }
  ]
})

tester.run('no-divider-comment', local.rules['no-divider-comment'], {
  valid: ['// A plain comment.\nrun()\n'],
  invalid: [
    {
      code: 'run()\n// -----\nstop()\n',
      output: 'run()\nstop()\n',
      errors: [{message: 'Remove the section divider comment.'}]
    },
    {
      code: 'run()\n// -- Setup --\nstop()\n',
      output: 'run()\n// Setup\nstop()\n',
      errors: [{message: 'Remove the section divider comment.'}]
    },
    {
      code: 'run() // ═══ Teardown ═══\n',
      output: 'run() // Teardown\n',
      errors: [{message: 'Remove the section divider comment.'}]
    }
  ]
})

tester.run('no-jsdoc-description', local.rules['no-jsdoc-description'], {
  valid: ['/** @param {string} name */\nfunction f(name) {}\n'],
  invalid: [
    {
      code: '/**\n * Says hello.\n */\nfunction f() {}\n',
      output: 'function f() {}\n',
      errors: [{message: 'Remove the JSDoc description; keep only type tags.'}]
    },
    {
      code: '  /**\n   * Says hello.\n   * @param {string} name\n   */\n  function f(name) {}\n',
      output:
        '  /**\n   * @param {string} name\n   */\n  function f(name) {}\n',
      errors: [{message: 'Remove the JSDoc description; keep only type tags.'}]
    }
  ]
})

const padding = local.rules['padding-line-between-statements']
const blankAfterConst = [
  {blankLine: 'always', prev: 'const', next: '*'},
  {blankLine: 'any', prev: 'const', next: 'const'}
]

tester.run('padding-line-between-statements', padding, {
  valid: [
    {code: 'const a = 1\n\nrun(a)\n', options: blankAfterConst},
    // The ASI guard shares the line with the statement it protects.
    {code: 'const a = 1\n;[a].forEach(run)\n', options: blankAfterConst}
  ],
  invalid: [
    {
      code: 'const a = 1\nrun(a)\n',
      output: 'const a = 1\n\nrun(a)\n',
      options: blankAfterConst,
      errors: 1
    }
  ]
})
