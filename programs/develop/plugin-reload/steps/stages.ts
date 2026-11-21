// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export const REPLAY_SHIM_STAGE_AFTER_REPORT = 149

// The dev manifest is the last thing written at its stage, so every step
// below reads the grants and no reporting step of that stage does.
export const DEV_MANIFEST_STAGE_AFTER_REPORT = 100

// Each step prepends to the background, so the last to run sits on top.
// One stage each keeps that order off the order the steps are applied in.
export const DEV_CONTENT_SCRIPTS_STAGE_AFTER_REPORT =
  REPLAY_SHIM_STAGE_AFTER_REPORT + 1

// The bridge rides above the reload runtime in the same bundles.
export const BRIDGE_STAGE_AFTER_REPORT =
  DEV_CONTENT_SCRIPTS_STAGE_AFTER_REPORT + 1
