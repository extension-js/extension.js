#!/usr/bin/env node

//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import './helpers/node-version-guard'
import {processRunDeps, run} from './run'

// Public type surface for extension.config.js, re-exported from the root. The
// .js extension is required for node16/nodenext resolution (TS2834).
export type {
  BrowserConfig,
  BrowserType,
  CompanionExtensionsConfig,
  ConfigHookContext,
  FileConfig
} from './config-types.js'

void run(process.argv, processRunDeps())
