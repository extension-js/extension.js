import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
      }
    }
  },
  js.configs.recommended,
  {
    ignores: [
      '__TEST__',
      '**/dist/',
      '**/e2e-report/',
      '**/coverage/',
      '**/webpack.config.js',
      '**/postcss.config.js',
      '**/tailwind.config.js',
      '**/stylelint.config.json',
      // Ignore fixture/example sources not intended for linting
      '**/examples/**',
      'programs/develop/webpack/plugin-reload/extensions/**',
      'templates/javascript/**',
      // Ignore helper scripts that intentionally use underscore placeholders
      'scripts/aggregate-changelog.cjs',
      'scripts/render-aggregated-changelog.cjs'
    ]
  }
]
