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
      '**/rspack.config.js',
      '**/postcss.config.js',
      '**/tailwind.config.js',
      '**/stylelint.config.json'
    ]
  }
]
