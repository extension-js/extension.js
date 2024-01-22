export default function patchBackground(manifest: any) {
  if (!manifest.background) {
    if (manifest.version === 2) {
      return {
        background: {
          ...manifest.background,
          scripts: ['extension-reloader.js']
        }
      }
    }

    return {
      background: {
        ...manifest.background,
        service_worker: 'extension-reloader.js'
      }
    }
  }

  if (manifest.background.scripts) {
    return {
      background: {
        ...manifest.background,
        scripts: manifest.background.scripts
      }
    }
  }

  if (manifest.background.page) {
    return {
      background: {
        ...manifest.background,
        page: manifest.background.page
      }
    }
  }

  if (manifest.background.service_worker) {
    return {
      background: {
        ...manifest.background,
        service_worker: manifest.background.service_worker
      }
    }
  }

  return {
    background: {
      ...manifest.background,
      scripts: ['extension-reloader.js']
    }
  }
}
