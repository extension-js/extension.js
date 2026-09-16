// ███████╗██╗  ██╗████████╗███████╗███╗   ██╗███████╗██╗ ██████╗ ███╗   ██╗
// ██╔════╝╚██╗██╔╝╚══██╔══╝██╔════╝████╗  ██║██╔════╝██║██╔═══██╗████╗  ██║
// █████╗   ╚███╔╝    ██║   █████╗  ██╔██╗ ██║███████╗██║██║   ██║██╔██╗ ██║
// ██╔══╝   ██╔██╗    ██║   ██╔══╝  ██║╚██╗██║╚════██║██║██║   ██║██║╚██╗██║
// ███████╗██╔╝ ██╗   ██║   ███████╗██║ ╚████║███████║██║╚██████╔╝██║ ╚████║
// ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import babelParser from '@babel/eslint-parser'
import {includeIgnoreFile} from '@eslint/compat'
import local from './scripts/lib/eslint-style-rules.mjs'

// Biome owns correctness linting and formatting. ESLint only carries the
// layout and comment rules Biome cannot express.

const fromRoot = (path) => fileURLToPath(new URL(path, import.meta.url))

const ignoreFiles = ['.gitignore', '.git/info/exclude']
  .map(fromRoot)
  .filter((path) => existsSync(path))
  .map((path) => includeIgnoreFile(path))

// TypeScript 7 has no JS API for typescript-eslint, so Babel parses TS.
const babelTypeScript = (plugins) => ({
  parser: babelParser,
  parserOptions: {
    requireConfigFile: false,
    babelOptions: {babelrc: false, configFile: false, parserOpts: {plugins}}
  }
})

// Disable directives for rules this config never loads stay valid.
const knownElsewhere = {
  rules: {
    'no-var-requires': {create: () => ({})},
    'no-unused-vars': {create: () => ({})}
  }
}

export default [
  ...ignoreFiles,
  {
    ignores: [
      '_FUTURE/',
      'extensions/',
      'templates/',
      'templates-artifacts/',
      '**/dist/',
      '**/.rslib/',
      '**/build/',
      '**/out/',
      '**/coverage/',
      '**/e2e-report/',
      '**/playwright-report/',
      '**/test-results/',
      '**/.cache/',
      '**/.turbo/',
      '**/.pnpm-store/',
      '**/__TEST__/',
      '**/.tmp-*/',
      '**/webpack.config.js',
      '**/postcss.config.js',
      '**/tailwind.config.js',
      '**/*.generated.*',
      'programs/create/templates/',
      'programs/develop/plugin-reload/steps/setup-reload-strategy/webpack-target-webextension-fork/'
    ]
  },
  {
    linterOptions: {reportUnusedDisableDirectives: 'off'},
    plugins: {'@typescript-eslint': knownElsewhere}
  },
  {
    files: ['**/*.jsx'],
    languageOptions: {parserOptions: {ecmaFeatures: {jsx: true}}}
  },
  {
    files: ['**/*.{ts,mts,cts}'],
    languageOptions: babelTypeScript([['typescript', {}]])
  },
  {
    files: ['**/*.d.ts'],
    languageOptions: babelTypeScript([['typescript', {dts: true}]])
  },
  {
    files: ['**/*.tsx'],
    languageOptions: babelTypeScript([['typescript', {}], 'jsx'])
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: {local},
    rules: {
      curly: ['error', 'multi-line'],
      'local/padding-line-between-statements': [
        'error',
        {blankLine: 'always', prev: '*', next: ['return', 'throw']},
        {blankLine: 'always', prev: 'if', next: '*'},
        {blankLine: 'any', prev: 'if', next: 'if'},
        {blankLine: 'always', prev: '*', next: 'block-like'},
        {blankLine: 'always', prev: 'block-like', next: '*'},
        {blankLine: 'always', prev: 'multiline-expression', next: '*'},
        {blankLine: 'any', prev: '*', next: 'empty'},
        {blankLine: 'any', prev: 'empty', next: '*'}
      ],
      'local/blank-line-after-shebang': 'error',
      'local/no-file-header-comment': ['error', {allowBanner: true}],
      'local/no-divider-comment': ['error', {allowBanner: true}],
      'local/no-jsdoc-description': 'error'
    }
  },
  {
    // The public config and `extension/types` surface: its JSDoc is what users
    // read on hover in their own extension.config.js and source files.
    files: [
      'programs/extension/config-types.ts',
      'programs/extension/types/**'
    ],
    rules: {
      'local/no-file-header-comment': 'off',
      'local/no-divider-comment': 'off',
      'local/no-jsdoc-description': 'off'
    }
  }
]
