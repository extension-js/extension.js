export default function patchBackground(manifest: any) {
  if (!manifest.background) {
    if (manifest.manifest_version === 2) {
      return {
        background: {
          ...manifest.background,
          scripts: ['background/script.js']
        }
      }
    }

    return {
      background: {
        ...manifest.background,
        service_worker: 'service_worker/script.js'
      }
    }
  }

  return {
    background: {
      ...manifest.background
    }
  }
}
