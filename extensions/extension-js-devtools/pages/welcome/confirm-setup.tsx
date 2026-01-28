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
import {ChromiumSwitch} from '../../src/components/chromium-switch'

export function ConfirmSetupDialog() {
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
              <div className="pointer-events-none flex items-center justify-between gap-4 rounded-lg border bg-[#1f1f1f] p-4 sm:p-6">
                <ChromiumSwitch className="max-w-[520px] flex-1" />
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
