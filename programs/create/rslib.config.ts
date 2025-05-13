import * as path from 'path'
import {defineConfig} from '@rslib/core'

export default defineConfig({
  source: {
    entry: {
      module: path.resolve(__dirname, './module.ts')
    }
  },
  lib: [
    {
      format: 'cjs',
      syntax: 'es2021',
      dts: true
    }
  ]
})
