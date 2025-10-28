import React, {useEffect, useState} from 'react'
import {
  ExternalLink as ExternalLinkIcon,
  MoonIcon,
  SunIcon,
  XIcon,
  Settings as SettingsIcon,
  Cog,
  CogIcon
} from 'lucide-react'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose
} from '@/components/ui/drawer'
import {Button} from '@/components/ui/button'
import {Table, TableBody, TableRow, TableCell} from '@/components/ui/table'
import {Card, CardContent, CardFooter} from '@/components/ui/card'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/sonner'

const AnyDrawerTrigger = DrawerTrigger as any
const AnyDrawerContent = DrawerContent as any
const AnyDrawerHeader = DrawerHeader as any
const AnyDrawerTitle = DrawerTitle as any
const AnyDrawerClose = DrawerClose as any

export function SettingsAside() {
  const [captureStacks, setCaptureStacks] = useState<boolean>(false)
  const [captureNetworkErrors, setCaptureNetworkErrors] =
    useState<boolean>(false)

  useEffect(() => {
    try {
      chrome.storage.session.get(
        ['logger_capture_stacks', 'logger_capture_network'],
        (data) => {
          try {
            setCaptureStacks(Boolean(data?.logger_capture_stacks))
            setCaptureNetworkErrors(
              String(data?.logger_capture_network || 'off') === 'errors'
            )
          } catch {}
        }
      )
    } catch {}
  }, [])

  return (
    <aside className="max-[1024px]:hidden ml-auto inline-flex items-center gap-2">
      <Drawer>
        <AnyDrawerTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <SettingsIcon className="h-3 w-3" />
              Settings
            </span>
          </Button>
        </AnyDrawerTrigger>
        <AnyDrawerContent className="w-full">
          <AnyDrawerHeader>
            <div className="relative">
              <AnyDrawerTitle className="flex items-center gap-2">
                <CogIcon className="size-5" />
                Settings
              </AnyDrawerTitle>
              <AnyDrawerClose asChild>
                <button
                  aria-label="Close"
                  className="absolute right-2 top-[-5px] inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </AnyDrawerClose>
            </div>
          </AnyDrawerHeader>
          <div className="px-4 pb-4">
            <Card className="w-full">
              <CardContent className="p-0">
                <Table className="text-xs [&_tr]:h-[44px]">
                  <TableBody>
                    <TableRow>
                      <TableCell className="w-[200px] px-4">Theme</TableCell>
                      <TableCell>
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs">
                            <SunIcon className="h-3.5 w-3.5" />
                          </span>
                          <Switch
                            id="theme-switch"
                            onCheckedChange={(checked) => {
                              try {
                                const root = document.documentElement
                                if (checked === undefined) return
                                if (checked) root.classList.add('dark')
                                else root.classList.remove('dark')
                                chrome.storage?.session?.set?.({
                                  logger_theme: checked ? 'dark' : 'light'
                                })
                              } catch {}
                            }}
                            defaultChecked={(() => {
                              try {
                                return matchMedia(
                                  '(prefers-color-scheme: dark)'
                                ).matches
                              } catch {
                                return false
                              }
                            })()}
                          />
                          <span className="text-xs">
                            <MoonIcon className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="w-[200px] px-4">
                        Capture stacks
                      </TableCell>
                      <TableCell>
                        <div className="inline-flex items-center gap-2">
                          <Switch
                            id="stacks-switch"
                            checked={captureStacks}
                            onCheckedChange={(checked) => {
                              try {
                                const next = Boolean(checked)
                                setCaptureStacks(next)
                                chrome.storage?.session?.set?.({
                                  logger_capture_stacks: next
                                })
                              } catch {}
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="w-[200px] px-4">
                        Capture network errors
                      </TableCell>
                      <TableCell>
                        <div className="inline-flex items-center gap-2">
                          <Switch
                            id="network-switch"
                            checked={captureNetworkErrors}
                            onCheckedChange={(checked) => {
                              try {
                                const next = Boolean(checked)
                                setCaptureNetworkErrors(next)
                                chrome.storage?.session?.set?.({
                                  logger_capture_network: next
                                    ? 'errors'
                                    : 'off'
                                })
                              } catch {}
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="w-[200px] px-4">Feedback</TableCell>
                      <TableCell>
                        <a
                          href="https://github.com/cezaraugusto/extension.js"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs underline hover:opacity-80 inline-flex items-center gap-1"
                        >
                          View Extension.js on GitHub
                          <ExternalLinkIcon className="h-3 w-3" />
                        </a>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="w-[200px] px-4">
                        Learn More
                      </TableCell>
                      <TableCell>
                        <a
                          href="https://extension.js.org"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs underline hover:opacity-80 inline-flex items-center gap-1"
                        >
                          Learn more about creating cross-browser extensions
                          <ExternalLinkIcon className="h-3 w-3" />
                        </a>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </AnyDrawerContent>
      </Drawer>
      <a
        href="https://extension.js.org"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center"
        title="extension.js.org"
      >
        <img src={'/logo.png'} alt="Extension.js" className="h-6 w-auto" />
      </a>
    </aside>
  )
}
