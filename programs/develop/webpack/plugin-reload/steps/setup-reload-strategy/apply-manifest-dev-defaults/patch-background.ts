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
        service_worker: 'background/service_worker.js'
      }
    }
  }

  return {
    background: {
      ...manifest.background
    }
  }
}
