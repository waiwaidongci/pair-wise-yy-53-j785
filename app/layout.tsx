import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { AppShell } from '@/components/AppShell'

export const metadata: Metadata = { title: '内容发行权窗口审阅台', description: '影视内容授权窗口、独占范围与冲突审阅' }

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body suppressHydrationWarning><Providers><AppShell>{children}</AppShell></Providers></body></html>
}
