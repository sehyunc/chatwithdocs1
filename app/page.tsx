import { SearchDialog } from '@/components/SearchDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'

export const runtime = 'edge'

const Page = () => {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="flex flex-col items-center gap-2">
        {/* <h1 className="mb-4 text-4xl font-extrabold tracking-tight lg:text-5xl">Chat with docs.</h1>
        <div className="flex gap-2 w-full">
          <Input placeholder="Enter GitHub URL" />
          <Button>Chat</Button>
        </div>
        <p className="text-muted-foreground text-sm">
          e.g. https://github.com/reactjs/react.dev/tree/main/src/content
        </p> */}

        <span className="flex items-center">
          <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
            loading&nbsp;
          </h1>
          <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">
            react&nbsp;
          </h1>
          <h1 className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl">docs</h1>
        </span>
        <div className="flex w-full items-center gap-4">
          <Progress value={77} className="w-full" />
          <p>77%</p>
        </div>
      </div>
    </main>
  )
}

export default Page
