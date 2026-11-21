// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {extensionPreview as PreviewCommand} from './command-preview'
import {ensureRustMinStack} from './lib/rust-min-stack'

export type {
  PreviewLauncherFn,
  ResolvedPreviewOptions
} from './command-preview'
export type {PublicPreviewOptions as PreviewOptions} from './types'

// A host can import this entry before the main one, so the guard runs here
// too, ahead of the command file that reaches rspack.
ensureRustMinStack()

const preview = await import('./command-preview')

export const extensionPreview: typeof PreviewCommand = preview.extensionPreview
