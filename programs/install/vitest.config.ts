//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {defineConfig} from 'vitest/config'
import {droppedVitestFiltersMessage} from '../../scripts/lib/vitest-filter-args.mjs'

// Vitest drops a filter written after `--` or right after `-u`, and a
// direct call would then start the whole suite. pnpm test rewrites both.
const dropped = droppedVitestFiltersMessage(process.argv.slice(2))

if (dropped) throw new Error(dropped)

export default defineConfig({
  test: {
    pool: 'forks',
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts'],
    // A test that runs no assertion fails instead of passing empty.
    expect: {requireAssertions: true},
    // One temp folder for the whole run, removed when the run ends.
    globalSetup: ['../../scripts/lib/spec-temp-folder.mjs']
  }
})
