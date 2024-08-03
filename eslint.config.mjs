import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    languageOptions: {
      globals: globals.browser
    }
  },
  js.configs.recommended,
  {
    ignores: ['__TEST__', '**/dist/', 'tailwind.config.js', 'stylelint.config.js']
  }
]
