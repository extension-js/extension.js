import {Button} from '@/components/ui/button'
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
import './styles.css'
import shadcnLogo from '../images/shadcn.svg'

export default function SidebarApp() {
  return (
    <Card className="h-full">
      <CardHeader>
        <img src={shadcnLogo} alt="shadcn Logo" className="w-12 h-12" />
        <CardTitle>
          <CardTitle>Welcome to your shadcn Extension.</CardTitle>
          <CardDescription>Manage your cookie settings here.</CardDescription>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="flex items-center justify-between space-x-4">
          <Label htmlFor="necessary" className="flex flex-col space-y-1">
            <span>Strictly Necessary</span>
            <span className="text-xs font-normal leading-snug text-muted-foreground">
              These cookies are essential in order to use the website and use
              its features.
            </span>
          </Label>
          <Switch id="necessary" defaultChecked aria-label="Necessary" />
        </div>
        <div className="flex items-center justify-between space-x-4">
          <Label htmlFor="functional" className="flex flex-col space-y-1">
            <span>Functional Cookies</span>
            <span className="text-xs font-normal leading-snug text-muted-foreground">
              These cookies allow the website to provide personalized
              functionality.
            </span>
          </Label>
          <Switch id="functional" aria-label="Functional" />
        </div>
        <div className="flex items-center justify-between space-x-4">
          <Label htmlFor="performance" className="flex flex-col space-y-1">
            <span>Performance Cookies</span>
            <span className="text-xs font-normal leading-snug text-muted-foreground">
              These cookies help to improve the performance of the website.
            </span>
          </Label>
          <Switch id="performance" aria-label="Performance" />
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
