import path from 'path'
import {defineConfig} from '@rslib/core'

export default defineConfig({
  source: {
    entry: {
      module: path.resolve(__dirname, './module.ts')
    }
  },
  lib: [
    {
      format: 'esm',
      syntax: 'es2021',
      dts: true
      // bundle: false
    }
    // {
    //   format: 'cjs',
    //   syntax: 'es2021'
    //   // bundle: false
    // }
  ]
})
