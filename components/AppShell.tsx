'use client'

import { Box, Flex, HStack, Heading, Text, Badge, Button } from '@chakra-ui/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const nav = [
  { href: '/', label: '窗口总览' },
  { href: '/windows', label: '授权窗口' },
  { href: '/reviews', label: '审阅与版本' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <Flex minH="100vh">
      <Box as="aside" w={{ base: '72px', lg: '224px' }} bg="#0f172a" color="white" position="sticky" top={0} h="100vh" px={{ base: 2, lg: 3 }} py={4}>
        <HStack px={2} pb={5} borderBottom="1px solid" borderColor="#263247">
          <Flex w="38px" h="38px" minW="38px" bg="brand.500" borderRadius="8px" align="center" justify="center" fontWeight="900">权</Flex>
          <Box display={{ base: 'none', lg: 'block' }}><Text fontWeight="800">发行权窗口台</Text><Text fontSize="9px" color="#7f8c9f" letterSpacing="1px">RIGHTS CONTROL</Text></Box>
        </HStack>
        <Flex direction="column" gap={1} mt={4}>{nav.map((item) => <Button key={item.href} as={Link} href={item.href} justifyContent="flex-start" variant="ghost" colorScheme="whiteAlpha" bg={pathname === item.href ? 'whiteAlpha.200' : 'transparent'} color={pathname === item.href ? 'white' : '#aebbd0'} px={3}>{item.label}</Button>)}</Flex>
      </Box>
      <Box minW={0} flex={1}>
        <Flex h="64px" bg="white" borderBottom="1px solid" borderColor="gray.200" align="center" px={5} gap={3} position="sticky" top={0} zIndex={20}>
          <Box flex={1}><Heading fontSize="sm">华映内容集团 · 2026 国际发行草案</Heading><Text fontSize="11px" color="gray.500" display={{ base: 'none', md: 'block' }}>法务与发行联合审阅</Text></Box>
          <Badge colorScheme="green" variant="subtle">版本 v18 已自动保存</Badge>
          <Button size="sm" colorScheme="blue">发起审批</Button>
        </Flex>
        <Box p={{ base: 3, lg: 5 }} maxW="1680px" mx="auto">{children}</Box>
      </Box>
    </Flex>
  )
}
