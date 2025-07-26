import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import shadcnLogo from '../images/shadcn.svg'

export default function SidebarApp() {
  return (
    <Card className="h-screen">
      <CardHeader>
        <img src={shadcnLogo} alt="shadcn Logo" className="size-12" />
        <CardTitle>Welcome to your shadcn Extension.</CardTitle>
        <CardDescription>Manage your cookie settings here.</CardDescription>
      </CardHeader>
      <CardContent className="px-6 grid gap-6">
        <div className="flex items-center justify-between gap-4">
          <Label
            htmlFor="necessary"
            className="gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 flex flex-col items-start"
          >
            <span>Strictly Necessary</span>
            <span className="text-muted-foreground leading-snug font-normal">
              These cookies are essential in order to use the website and use
              its features.
            </span>
          </Label>
          <Switch id="necessary" defaultChecked aria-label="Necessary" />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label
            htmlFor="functional"
            className="gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 flex flex-col items-start"
          >
            <span>Functional Cookies</span>
            <span className="text-muted-foreground leading-snug font-normal">
              These cookies allow the website to provide personalized
              functionality.
            </span>
          </Label>
          <Switch id="functional" aria-label="Functional" />
        </div>
      </CardContent>
      <CardFooter>
        <p>
          Learn more about creating cross-browser extensions at{' '}
          <a
            href="https://extension.js.org"
            target="_blank"
            className="underline"
          >
            https://extension.js.org
          </a>
          .
        </p>
      </CardFooter>
    </Card>
  )
}
