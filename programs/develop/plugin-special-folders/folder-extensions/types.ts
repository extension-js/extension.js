// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

/**
 * Companion extensions are "load-only" unpacked extension directories that
 * should be loaded alongside the user extension in dev/preview/start.
 *
 * Each directory MUST be an unpacked extension root containing a manifest.json.
 */
export type CompanionExtensionsConfig =
  | string[]
  | {
      /**
       * Folder to scan for subfolders that contain a manifest.json.
       * Example: "./extensions" -> loads "./extensions/*" (one level deep)
       */
      dir?: string
      /**
       * Explicit extension directories to load (absolute or relative to projectRoot).
       */
      paths?: string[]
    }
