// ███████╗██╗  ██╗ █████╗ ██████╗ ███████╗██████╗
// ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗
// ███████╗███████║███████║██████╔╝█████╗  ██║  ██║
// ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝  ██║  ██║
// ███████║██║  ██║██║  ██║██║  ██║███████╗██████╔╝
// ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'

// The global and the attribute that name which script owns a root. Shipped
// bundles carry both, so their spelling stays as it always was.
export const CONTENT_SCRIPT_OWNER_KEY_GLOBAL = '__EXTENSIONJS_REINJECT_KEY'
export const CONTENT_SCRIPT_OWNER_KEY_ATTRIBUTE = 'data-extjs-reinject-key'

// The places in the content script wrapper where another plugin may add
// text, named for where they sit in the emitted script.
export type ContentScriptWrapperPoint =
  | 'style-host-filter'
  | 'after-bridge-base'
  | 'after-owner-token'
  | 'after-style-urls'
  | 'after-cleanup-list'
  | 'after-register-cleanup'
  | 'in-composed-cleanup'
  | 'after-composed-cleanup'
  | 'before-asset-base'
  | 'mount-without-function'
  | 'after-mount'
  | 'mount-failed'
  | 'end-before-styles'
  | 'end-after-styles'
  | 'before-mount-call'
  | 'after-mount-call'

// What the wrapper knows about the module it wraps.
export interface ContentScriptWrapperModule {
  source: string
  isMainWorld: boolean
}

export interface ContentScriptWrapperExtension {
  textAt(
    point: ContentScriptWrapperPoint,
    module: ContentScriptWrapperModule
  ): string
}

const extensionsByCompiler = new WeakMap<
  Compiler,
  ContentScriptWrapperExtension[]
>()

// One list per compiler, handed to the wrapper loader by reference, so a
// plugin applied after the wrapper still reaches every module it wraps.
export function contentScriptWrapperExtensionsFor(
  compiler: Compiler
): ContentScriptWrapperExtension[] {
  let extensions = extensionsByCompiler.get(compiler)

  if (!extensions) {
    extensions = []
    extensionsByCompiler.set(compiler, extensions)
  }

  return extensions
}

export function extendContentScriptWrapper(
  compiler: Compiler,
  extension: ContentScriptWrapperExtension
): void {
  const extensions = contentScriptWrapperExtensionsFor(compiler)

  if (!extensions.includes(extension)) extensions.push(extension)
}
