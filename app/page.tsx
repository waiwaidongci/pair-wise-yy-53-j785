'use client'

import { Box, Flex, Grid, Heading, Text, Badge, Button, Table, Thead, Tbody, Tr, Th, Td, Progress } from '@chakra-ui/react'
import Link from 'next/link'
import { useRightsStore, useConflicts } from '@/store/rights'
import { trpc } from '@/trpc/client'

export default function Dashboard() {
  const windows = useRightsStore((state) => state.windows)
  const comments = useRightsStore((state) => state.comments)
  const version = useRightsStore((state) => state.version)
  const conflicts = useConflicts()
  const catalog = trpc.catalog.useQuery()
  const cards = [
    { label: '授权窗口', value: windows.length, note: `${catalog.data?.works.length ?? 2} 部作品` },
    { label: '责任地区', value: new Set(windows.map((item) => item.territory)).size, note: '联动地区矩阵' },
    { label: '高优先级冲突', value: conflicts.filter((item) => item.severity === '高').length, note: '阻止审批通过' },
    { label: '当前草案', value: `v${version}`, note: '自动保留本地版本' },
  ]
  return (
    <Box>
      <Flex justify="space-between" align="flex-start" gap={4} mb={5} direction={{ base: 'column', md: 'row' }}>
        <Box><Text color="brand.600" fontSize="xs" fontWeight="bold">版权窗口与独占规则</Text><Heading fontSize={{ base: '2xl', md: '3xl' }} my={1}>授权窗口审阅总览</Heading><Text color="gray.600">联动核验时间、地区、渠道、权利类型与独占范围，修改在审批前保留完整版本。</Text></Box>
        <Flex gap={2}><Button as={Link} href="/reviews" variant="outline">比较版本</Button><Button as={Link} href="/windows" colorScheme="blue">调整窗口</Button></Flex>
      </Flex>
      <Grid templateColumns={{ base: 'repeat(2,1fr)', lg: 'repeat(4,1fr)' }} gap={4} mb={5}>
        {cards.map((card) => <Box key={card.label} bg="white" border="1px solid" borderColor="gray.200" borderLeft="4px solid" borderLeftColor="brand.500" borderRadius="8px" p={4}><Text color="gray.500" fontSize="sm">{card.label}</Text><Heading size="lg" my={1}>{card.value}</Heading><Text color="gray.500" fontSize="xs">{card.note}</Text></Box>)}
      </Grid>
      <Grid templateColumns={{ base: '1fr', xl: '1.55fr .8fr' }} gap={4} mb={4}>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" overflow="hidden">
          <Flex p={4} justify="space-between"><Box><Heading size="md">窗口时间轴</Heading><Text color="gray.500" fontSize="sm">按作品与渠道显示授权跨度</Text></Box><Badge colorScheme="blue">2026–2027</Badge></Flex>
          <Box px={4} pb={4} overflowX="auto">
            {windows.map((item) => {
              const duration = Math.max(8, (new Date(item.end).getTime() - new Date(item.start).getTime()) / 86400000 / 730 * 100)
              const offset = Math.max(0, (new Date(item.start).getTime() - new Date('2026-10-01').getTime()) / 86400000 / 730 * 100)
              return <Box key={item.id} minW="760px" mb={3}><Flex justify="space-between" fontSize="sm" mb={1}><Text fontWeight="600">{item.work} · {item.channel}</Text><Text color="gray.500">{item.start} → {item.end}</Text></Flex><Box position="relative" h="25px" bg="gray.100" borderRadius="4px"><Box position="absolute" left={`${Math.min(offset, 92)}%`} w={`${Math.min(duration, 100 - offset)}%`} h="25px" bg={item.exclusive ? 'blue.500' : 'cyan.400'} borderRadius="4px" display="flex" alignItems="center" px={2} color="white" fontSize="11px" whiteSpace="nowrap" overflow="hidden">{item.rights}{item.exclusive ? ' · 独占' : ''}</Box></Box></Box>
            })}
          </Box>
        </Box>
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
          <Heading size="md" mb={4}>冲突解释</Heading>
          {conflicts.slice(0, 3).map((issue) => <Box key={issue.id} p={3} mb={3} bg={issue.severity === '高' ? 'red.50' : 'orange.50'} borderLeft="3px solid" borderLeftColor={issue.severity === '高' ? 'red.500' : 'orange.400'} borderRadius="6px"><Flex justify="space-between"><Text fontWeight="700" fontSize="sm">{issue.title}</Text><Badge colorScheme={issue.severity === '高' ? 'red' : 'orange'}>{issue.type}</Badge></Flex><Text fontSize="sm" color="gray.600" mt={2}>{issue.explanation}</Text></Box>)}
          <Progress value={Math.max(0, 100 - conflicts.length * 18)} colorScheme="blue" borderRadius="4px" mt={4} />
          <Text color="gray.500" fontSize="xs" mt={2}>规则完备度 {Math.max(0, 100 - conflicts.length * 18)}% · {comments.filter((item) => !item.resolved).length} 条意见待处理</Text>
        </Box>
      </Grid>
      <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" overflow="hidden">
        <Flex p={4} justify="space-between"><Heading size="md">待决授权条款</Heading><Button size="sm" variant="ghost">查看全部</Button></Flex>
        <Table size="sm"><Thead><Tr><Th>作品 / 渠道</Th><Th>权利</Th><Th>地区</Th><Th>窗口</Th><Th>独占</Th><Th>状态</Th></Tr></Thead><Tbody>{windows.map((item) => <Tr key={item.id}><Td><Text fontWeight="600">{item.work}</Text><Text color="gray.500" fontSize="xs">{item.channel} · {item.id}</Text></Td><Td>{item.rights}</Td><Td>{item.territory}</Td><Td>{item.start} → {item.end}</Td><Td><Badge colorScheme={item.exclusive ? 'purple' : 'gray'}>{item.exclusive ? '独占' : '非独占'}</Badge></Td><Td><Badge colorScheme={item.status === '冲突' ? 'red' : item.status === '已确认' ? 'green' : 'orange'}>{item.status}</Badge></Td></Tr>)}</Tbody></Table>
      </Box>
    </Box>
  )
}
