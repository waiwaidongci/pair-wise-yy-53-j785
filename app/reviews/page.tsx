'use client'

import { useState } from 'react'
import { Box, Flex, Grid, Heading, Text, Badge, Button, Textarea, Checkbox, Tabs, TabList, Tab, TabPanels, TabPanel, useToast, HStack } from '@chakra-ui/react'
import { useRightsStore } from '@/store/rights'
import { versions } from '@/lib/mock-data'

export default function ReviewsPage() {
  const comments = useRightsStore((state) => state.comments)
  const acceptComment = useRightsStore((state) => state.acceptComment)
  const [draft, setDraft] = useState('流媒体开窗日期以院线独占结束次日为准，并单独拆分港澳台物料。')
  const [accepted, setAccepted] = useState<string[]>(['RW-102 开窗日期由 11-15 调整为 11-20'])
  const toast = useToast()

  function exportPackage() {
    const report = { version: 'v18', generatedAt: new Date().toISOString(), accepted, unresolved: comments.filter((item) => !item.resolved).map((item) => ({ anchor: item.anchor, author: item.author, content: item.content })) }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = '发行权审批包-v18.json'
    link.click()
    URL.revokeObjectURL(link.href)
    toast({ title: '审批包已导出', status: 'success' })
  }
  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}><Box><Text color="brand.600" fontSize="xs" fontWeight="bold">VERSION & APPROVAL</Text><Heading fontSize="3xl" my={1}>版本比较与条款合并</Heading><Text color="gray.600">评论锚定具体窗口和条款，任意版本可逐项接受，已确认版本进入只读审批。</Text></Box><Button colorScheme="blue" onClick={exportPackage}>导出可追溯审批包</Button></Flex>
      <Tabs colorScheme="blue" variant="enclosed">
        <TabList><Tab>条款意见</Tab><Tab>版本差异</Tab><Tab>审批时间线</Tab></TabList>
        <TabPanels>
          <TabPanel px={0} pt={4}><Grid templateColumns={{ base: '1fr', lg: '1.3fr .8fr' }} gap={4}>
            <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px">{comments.map((comment) => <Box key={comment.id} p={4} borderBottom="1px solid" borderColor="gray.100"><Flex justify="space-between"><Box><Text fontWeight="700">{comment.role} · {comment.author}</Text><Text color="gray.500" fontSize="xs">{comment.anchor}</Text></Box><Badge colorScheme={comment.resolved ? 'green' : 'orange'}>{comment.resolved ? '已解决' : '待处理'}</Badge></Flex><Text color="gray.600" mt={3}>{comment.content}</Text>{!comment.resolved && <Button mt={3} size="sm" colorScheme="blue" variant="outline" onClick={() => acceptComment(comment.id)}>接受并合并条款</Button>}</Box>)}</Box>
            <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}><Heading size="md" mb={3}>发表评论锚点</Heading><Badge mb={3}>RW-102 · 独占范围</Badge><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={7} /><Button mt={3} colorScheme="blue" isDisabled={!draft.trim()} onClick={() => { acceptComment(`new-${Date.now()}`); toast({ title: '评论已加入审阅草稿', status: 'success' }) }}>提交法务意见</Button></Box>
          </Grid></TabPanel>
          <TabPanel px={0} pt={4}><Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={4}>{versions.slice(0, 2).map((version) => <Box key={version.id} bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}><Flex justify="space-between"><Box><Heading size="md">{version.id}</Heading><Text color="gray.500" fontSize="sm">{version.author} · {version.time}</Text></Box><Badge>{version.changes.length} 项</Badge></Flex><Text fontWeight="600" mt={4}>{version.summary}</Text>{version.changes.map((change) => <Checkbox key={change} mt={3} isChecked={accepted.includes(change)} onChange={(event) => setAccepted((current) => event.target.checked ? [...current, change] : current.filter((item) => item !== change))}>{change}</Checkbox>)}</Box>)}</Grid></TabPanel>
          <TabPanel px={0} pt={4}><Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5}><HStack align="flex-start" mb={5}><Badge colorScheme="green">16:35</Badge><Box><Text fontWeight="700">章宁提交 v18</Text><Text color="gray.500" fontSize="sm">调整流媒体窗口，新增港台地区和次级授权约束。</Text></Box></HStack><HStack align="flex-start" mb={5}><Badge colorScheme="orange">16:42</Badge><Box><Text fontWeight="700">黎清提出窗口倒挂意见</Text><Text color="gray.500" fontSize="sm">意见锚定 RW-101 / RW-102 的院线独占尾部。</Text></Box></HStack><HStack align="flex-start"><Badge colorScheme="gray">待处理</Badge><Box><Text fontWeight="700">发行负责人审批</Text><Text color="gray.500" fontSize="sm">解决全部高风险冲突后进入只读审批。</Text></Box></HStack></Box></TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  )
}
