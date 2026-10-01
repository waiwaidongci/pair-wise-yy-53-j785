import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@trpc/server', '@trpc/client', '@trpc/react-query'],
}

export default nextConfig
