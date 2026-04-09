// ██████╗ ██████╗ ███████╗██╗   ██╗██╗███████╗██╗    ██╗
// ██╔══██╗██╔══██╗██╔════╝██║   ██║██║██╔════╝██║    ██║
// ██████╔╝██████╔╝█████╗  ██║   ██║██║█████╗  ██║ █╗ ██║
// ██╔═══╝ ██╔══██╗██╔══╝  ╚██╗ ██╔╝██║██╔══╝  ██║███╗██║
// ██║     ██║  ██║███████╗ ╚████╔╝ ██║███████╗╚███╔███╔╝
// ╚═╝     ╚═╝  ╚═╝╚══════╝  ╚═══╝  ╚═╝╚══════╝ ╚══╝╚══╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

// Lightweight entry point for the `extension preview` command.
// This bundle intentionally avoids importing rspack or any heavy build
// dependencies so that `extension preview` starts instantly.

export {extensionPreview} from './webpack/command-preview'
export type {PreviewOptions} from './webpack/webpack-types'
