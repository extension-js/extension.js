// ██████╗ ██╗   ██╗██╗██╗     ██████╗     ███████╗██╗   ██╗███████╗███╗   ██╗████████╗███████╗
// ██╔══██╗██║   ██║██║██║     ██╔══██╗    ██╔════╝██║   ██║██╔════╝████╗  ██║╚══██╔══╝██╔════╝
// ██████╔╝██║   ██║██║██║     ██║  ██║    █████╗  ██║   ██║█████╗  ██╔██╗ ██║   ██║   ███████╗
// ██╔══██╗██║   ██║██║██║     ██║  ██║    ██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║╚██╗██║   ██║   ╚════██║
// ██████╔╝╚██████╔╝██║███████╗██████╔╝    ███████╗ ╚████╔╝ ███████╗██║ ╚████║   ██║   ███████║
// ╚═════╝  ╚═════╝ ╚═╝╚══════╝╚═════╝     ╚══════╝  ╚═══╝  ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {EventEmitter} from 'node:events'

export type ReloadType = 'full' | 'service-worker' | 'content-scripts'

export interface ReloadInstruction {
  type: ReloadType
  changedContentScriptEntries?: string[]
  changedAssets?: string[]
}

export interface CompiledEvent {
  outputPath: string
  contextDir: string
  isFirstCompile: boolean
  reloadInstruction?: ReloadInstruction
}

export interface BuildErrorEvent {
  errors: string[]
}

export interface BuildEventMap {
  compiled: [CompiledEvent]
  error: [BuildErrorEvent]
  close: []
}

export class BuildEmitter extends EventEmitter<BuildEventMap> {}
