'use client'

import { ChakraProvider, extendTheme } from '@chakra-ui/react'
import { TrpcProvider } from '@/trpc/provider'

const theme = extendTheme({
  fonts: { heading: '"PingFang SC", "Microsoft YaHei", sans-serif', body: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  colors: { brand: { 50: '#eff6ff', 100: '#dbeafe', 500: '#2563eb', 600: '#1d4ed8', 700: '#1e40af' } },
})

export function Providers({ children }: { children: React.ReactNode }) {
  return <ChakraProvider theme={theme}><TrpcProvider>{children}</TrpcProvider></ChakraProvider>
}
