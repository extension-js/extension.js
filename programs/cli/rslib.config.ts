import path from 'path'
import {defineConfig} from '@rslib/core'

export default defineConfig({
  source: {
    entry: {
      cli: path.resolve(__dirname, './cli.ts')
    }
  },
  lib: [
    {
      format: 'esm',
      syntax: 'es2021',
      dts: true,
      // bundle: false
    },
    {
      format: 'cjs',
      syntax: 'es2021',
      // bundle: false
    }
  ]
})
