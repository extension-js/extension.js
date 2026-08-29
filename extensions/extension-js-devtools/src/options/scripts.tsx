// ██████╗ ███████╗██╗   ██╗████████╗ ██████╗  ██████╗ ██╗     ███████╗
// ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝
// ██║  ██║█████╗  ██║   ██║   ██║   ██║   ██║██║   ██║██║     ███████╗
// ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██║   ██║██║   ██║██║     ╚════██║
// ██████╔╝███████╗ ╚████╔╝    ██║   ╚██████╔╝╚██████╔╝███████╗███████║
// ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {useEffect, useState} from 'react'
import ReactDOM from 'react-dom/client'
import logo from '@/images/logo.png'
import {Card, CardContent} from '@/components/ui/card'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import {applyTheme} from '@/lib/utils'
import {
  getOverlayEnabled,
  onOverlayEnabledChanged,
  setOverlayEnabled
} from '@/lib/overlay-settings'

import '@/styles.css'

applyTheme()

function OptionsApp() {
  const [overlayEnabled, setOverlayEnabledState] = useState<boolean | null>(
    null
  )

  useEffect(() => {
    let mounted = true

    getOverlayEnabled().then((enabled) => {
      if (mounted) setOverlayEnabledState(enabled)
    })

    // Stay in sync when another surface flips the same stored setting.
    const unsubscribe = onOverlayEnabledChanged((enabled) => {
      setOverlayEnabledState(enabled)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6 py-16">
        <header className="flex items-center gap-3">
          <img
            src={logo}
            alt="Extension.js logo"
            className="size-9 select-none rounded-lg"
          />
          <div>
            <h1 className="text-xl font-semibold leading-tight tracking-tight">
              Settings
            </h1>
            <p className="text-muted-foreground text-sm">
              Extension.js developer tools
            </p>
          </div>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Appearance
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between gap-6 px-4 py-4">
                <div className="space-y-1 pr-2">
                  <Label
                    htmlFor="overlay-switch"
                    className="cursor-pointer text-sm"
                  >
                    Show overlay
                  </Label>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Display the floating Extension.js badge and diagnostics
                    panel on pages while you develop. Turning this off hides
                    the overlay everywhere.
                  </p>
                </div>
                <Switch
                  id="overlay-switch"
                  checked={overlayEnabled ?? true}
                  disabled={overlayEnabled === null}
                  onCheckedChange={(checked) => {
                    const next = Boolean(checked)
                    setOverlayEnabledState(next)
                    setOverlayEnabled(next)
                  }}
                />
              </div>
            </CardContent>
          </Card>
          <p className="text-muted-foreground text-xs">
            Changes apply immediately to open tabs.
          </p>
        </section>
      </div>
    </div>
  )
}

const rootElement = document.getElementById('root')

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<OptionsApp />)
}
