import * as React from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import localNetworkPermission from '@/images/local-network-permission.png'
import developerModeOff from '@/images/developer-mode-off.jpeg'
import developerModeOn from '@/images/developer-mode-on.jpeg'

export function ConfirmSetupDialog() {
  const [isDeveloperModeOn, setIsDeveloperModeOn] = React.useState(false)

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      setIsDeveloperModeOn((value) => !value)
    }, 2400)

    return () => window.clearInterval(intervalId)
  }, [])

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="rounded-2xl text-xs">
          Confirm setup
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[600px] max-h-[80vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Confirm setup</DialogTitle>
          <DialogDescription>
            Quick checks to keep Extension.js running smoothly.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="bg-muted text-muted-foreground mt-0.5 inline-flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                1
              </span>
              <div className="space-y-1">
                <h3 className="text-foreground text-base font-semibold">
                  Turn on Developer mode
                </h3>
                <p className="text-muted-foreground text-sm">
                  Go to{' '}
                  <a
                    className="text-primary underline underline-offset-4"
                    href="chrome://extensions"
                  >
                    chrome://extensions
                  </a>{' '}
                  (your first tab) and make sure is on so service workers reload
                  during development. It is in the top right of the page.{' '}
                  <span className="text-foreground font-semibold">
                    Developer mode
                  </span>
                  .
                </p>
              </div>
            </div>
            <div className="w-full space-y-2">
              <div className="relative w-full max-w-[520px] overflow-hidden rounded-lg border border-white/10">
                <img
                  alt="Developer mode turned off"
                  src={developerModeOff}
                  className={`h-auto w-full transition duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isDeveloperModeOn
                      ? 'opacity-0'
                      : 'opacity-100'
                  }`}
                />
                <img
                  alt="Developer mode turned on"
                  src={developerModeOn}
                  className={`pointer-events-none absolute inset-0 h-auto w-full transition duration-600 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isDeveloperModeOn
                      ? 'opacity-100'
                      : 'opacity-0'
                  }`}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Developer mode off/on (animated).
              </p>
            </div>
          </section>
          <section className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="bg-muted text-muted-foreground mt-0.5 inline-flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                2
              </span>
              <div className="space-y-1">
                <h3 className="text-foreground text-base font-semibold">
                  Allow local network access for content scripts
                </h3>
                <p className="text-muted-foreground text-sm">
                  If you are using{' '}
                  <span className="font-mono">content_scripts</span>, the first
                  time you visit a targeted page you will see a local network
                  access prompt. This is expected—click Allow to continue.
                  Without it, content script reloads may not work reliably.
                </p>
              </div>
            </div>
            <img
              alt="Local network access permission prompt"
              className="rounded-lg border object-contain"
              src={localNetworkPermission}
            />
            <p className="text-muted-foreground text-xs">
              Allow local network access (prompt example).
            </p>
          </section>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button className="w-full">Got it</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
