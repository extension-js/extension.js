import React, {useEffect, useState} from 'react'
import {
  ExternalLink as ExternalLinkIcon,
  MoonIcon,
  SunIcon,
  XIcon,
  Settings as SettingsIcon,
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
import {Card, CardContent} from '@/components/ui/card'
import {Switch} from '@/components/ui/switch'
import {Input} from '@/components/ui/input'

export function SettingsAside() {
  const [themeChecked, setThemeChecked] = useState<boolean | undefined>(
    undefined
  )
  const [captureStacks, setCaptureStacks] = useState(false)
  const [externalToken, setExternalToken] = useState('')
  const [clearOnNav, setClearOnNav] = useState(false)
  const [followTab, setFollowTab] = useState(true)

  useEffect(() => {
    // Theme
    chrome.storage.local.get(['logger_theme'], (data) => {
      const theme = data?.logger_theme
      if (theme === 'light') {
        setThemeChecked(false)
      } else if (theme === 'dark') {
        setThemeChecked(true)
      } else {
        // Fallback to system preference
        const prefersDark = window.matchMedia(
          '(prefers-color-scheme: dark)'
        ).matches
        setThemeChecked(prefersDark)
      }
    })

    // Session options
    chrome.storage.session.get(
      ['logger_capture_stacks', 'logger_clear_on_nav', 'logger_follow_tab'],
      (data) => {
        if (typeof data?.logger_capture_stacks === 'boolean') {
          setCaptureStacks(data.logger_capture_stacks)
        }
        if (typeof data?.logger_clear_on_nav === 'boolean') {
          setClearOnNav(data.logger_clear_on_nav)
        }
        if (typeof data?.logger_follow_tab === 'boolean') {
          setFollowTab(data.logger_follow_tab)
        }
      }
    )

    // External token
    chrome.storage.local.get(['logger_external_token'], (data) => {
      if (typeof data?.logger_external_token === 'string') {
        setExternalToken(data.logger_external_token)
      }
    })
  }, [])

  // Handlers
  function handleThemeSwitch(checked: boolean | undefined) {
    if (checked === undefined) return
    document.documentElement.classList.toggle('dark', checked)
    setThemeChecked(!!checked)
    chrome.storage.local.set({
      logger_theme: checked ? 'dark' : 'light'
    })
  }

  function handleSwitchSessionOption(
    key: string,
    value: boolean,
    setter: (v: boolean) => void
  ) {
    setter(value)
    chrome.storage.session.set({[key]: value})
  }

  function handleExternalTokenChange(value: string) {
    setExternalToken(value)
    chrome.storage.local.set({
      logger_external_token: value || undefined
    })
  }

  return (
    <aside className="max-[1024px]:hidden ml-auto inline-flex items-center gap-2">
      <Drawer>
        <DrawerTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <SettingsIcon className="h-3 w-3" />
              Settings
            </span>
          </Button>
        </DrawerTrigger>
        <DrawerContent className="w-full">
          <DrawerHeader>
            <div className="relative flex items-center justify-between">
              <DrawerTitle className="flex items-center gap-2">
                <CogIcon className="size-5" />
                Settings
              </DrawerTitle>
              <DrawerClose asChild>
                <button
                  aria-label="Close"
                  className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </DrawerClose>
            </div>
          </DrawerHeader>
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
                            checked={themeChecked}
                            onCheckedChange={handleThemeSwitch}
                          />
                          <span className="text-xs">
                            <MoonIcon className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="w-[200px] px-4">
                        Follow inspected tab
                      </TableCell>
                      <TableCell>
                        <Switch
                          id="follow-tab"
                          checked={followTab}
                          onCheckedChange={(v) =>
                            handleSwitchSessionOption(
                              'logger_follow_tab',
                              Boolean(v),
                              setFollowTab
                            )
                          }
                        />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="w-[200px] px-4">
                        Clear on navigation
                      </TableCell>
                      <TableCell>
                        <Switch
                          id="clear-on-nav"
                          checked={clearOnNav}
                          onCheckedChange={(v) =>
                            handleSwitchSessionOption(
                              'logger_clear_on_nav',
                              Boolean(v),
                              setClearOnNav
                            )
                          }
                        />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="w-[200px] px-4">
                        Capture stacks
                      </TableCell>
                      <TableCell>
                        <Switch
                          id="capture-stacks"
                          checked={captureStacks}
                          onCheckedChange={(v) =>
                            handleSwitchSessionOption(
                              'logger_capture_stacks',
                              Boolean(v),
                              setCaptureStacks
                            )
                          }
                        />
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="w-[200px] px-4">
                        External token
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 max-w-[320px]">
                          <Input
                            value={externalToken}
                            placeholder="Optional token for external logs"
                            onChange={(e) =>
                              handleExternalTokenChange(e.currentTarget.value)
                            }
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
        </DrawerContent>
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
