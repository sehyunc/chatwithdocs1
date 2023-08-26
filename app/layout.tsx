import { PropsWithChildren } from 'react'
import './globals.css'
import SupabaseProvider from './supabase-provider'

export const metadata = {
  title: 'Chat with Docs',
  description: 'Finally, you can chat with your docs.',
}

export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <body className="">
        <SupabaseProvider>
          <main id="skip" className="min-h-[calc(100dvh-4rem)] md:min-h[calc(100dvh-5rem)]">
            {children}
          </main>
        </SupabaseProvider>
      </body>
    </html>
  )
}
