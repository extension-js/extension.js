export default function patchBackground(manifest: any) {
  if (!manifest.background) {
    return {
      background: {
        ...manifest.background,
        scripts: ['background/script.js']
      }
    }
  }

  // Firefox does not support service workers in background scripts
  // https://bugzilla.mozilla.org/show_bug.cgi?id=1573659
  if (manifest.background.service_worker) {
    console.warn(
      'Firefox does not support service workers in background scripts yet. ' +
        'See https://bugzilla.mozilla.org/show_bug.cgi?id=1573659. Ignoring...'
    )

    return {
      background: {
        ...manifest.background,
        scripts: ['background/script.js']
      }
    }
  }

  return {
    background: {
      ...manifest.background
    }
  }
}
