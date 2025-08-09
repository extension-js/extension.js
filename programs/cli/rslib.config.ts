import * as path from 'path'
import * as fs from 'fs'
import {defineConfig} from '@rslib/core'
import type {RslibConfig} from '@rslib/core'

function copyReadmePlugin() {
  return {
    name: 'copy-readme',
    setup(api: any) {
      api.onAfterBuild(() => {
        const sourceReadme = path.join(__dirname, '../../README.md')
        const targetReadme = path.join(__dirname, '../README.md')
        copyIfDifferent(sourceReadme, targetReadme)
      })
    }
  }
}

function copyIfDifferent(source: string, target: string): void {
  if (!fs.existsSync(source)) {
    console.error(`Error: Source file ${source} not found`)
    process.exit(1)
  }

  if (fs.existsSync(target)) {
    const sourceContent = fs.readFileSync(source, 'utf8')
    const targetContent = fs.readFileSync(target, 'utf8')

    if (sourceContent !== targetContent) {
      fs.copyFileSync(source, target)
      console.log(
        `[Extension.js setup] File ${path.basename(source)} copied to ${target}`
      )
    } else {
      console.log(
        `[Extension.js setup] File ${path.basename(source)} haven't changed. Skipping copy...`
      )
    }
  } else {
    fs.copyFileSync(source, target)
    console.log(
      `[Extension.js setup] File ${path.basename(source)} copied to ${target}`
    )
  }
}

export default defineConfig({
  source: {
    entry: {
      cli: path.resolve(__dirname, './cli.ts')
    }
  },
  lib: [
    {
      format: 'cjs',
      syntax: 'es2021',
      dts: true
    }
  ],
  plugins: [copyReadmePlugin()]
} satisfies RslibConfig)
