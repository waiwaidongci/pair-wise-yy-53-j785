'use client'

import { useState } from 'react'
import {
  Box, Flex, Grid, Heading, Text, Badge, Button, Input, Select, Textarea,
  Table, Thead, Tbody, Tr, Th, Td, useToast, HStack, VStack, Divider, Tag,
} from '@chakra-ui/react'
import { trpc } from '@/trpc/client'
import type { ApprovalSnapshot, MutationResult } from '@/lib/approval-types'

const statusMeta: Record<ApprovalSnapshot['status'], { label: string; color: string }> = {
  active: { label: '审批中', color: 'blue' },
  invalidated: { label: '已失效', color: 'red' },
  superseded: { label: '已被后继取代', color: 'gray' },
  released: { label: '已发布正式版', color: 'green' },
}

const sourceLabel: Record<string, string> = {
  window: '授权窗口', exclusivity: '独占范围', comment: '条款意见', material: '物料',
}

function rid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export default function ApprovalsPage() {
  const view = trpc.approvalView.useQuery()
  const startApproval = trpc.startApproval.useMutation()
  const signoff = trpc.signoff.useMutation()
  const resubmit = trpc.resubmit.useMutation()
  const release = trpc.release.useMutation()
  const changeWindow = trpc.changeWindow.useMutation()
  const resolveComment = trpc.resolveComment.useMutation()
  const changeMaterial = trpc.changeMaterial.useMutation()
  const exportPackage = trpc.exportPackage.useMutation()
  const armCrash = trpc.armCrash.useMutation()
  const reset = trpc.resetApprovals.useMutation()
  const toast = useToast()
  const utils = trpc.useUtils()

  const [reason, setReason] = useState('2026 国际发行草案送审（院线 + 流媒体独占）')
  const [windowIds, setWindowIds] = useState<string[]>(['RW-101', 'RW-102'])
  const [reviewers, setReviewers] = useState('黎清（法务）,章宁（发行）')
  const [lastResult, setLastResult] = useState<MutationResult<unknown> | null>(null)

  const revision = view.data?.revision ?? 0
  const refresh = () => utils.approvalView.invalidate()

  /**
   * 统一写入封装：
   * - 自动带上当前修订号做乐观锁；
   * - 冲突时展示先到者请求号与首次结果，后到者可沿用；
   * - error（含注入的提交故障）保持同一请求号，点"恢复"即可重发。
   */
  async function run<T>(requestId: string, make: (id: string, expectedRevision: number) => Promise<MutationResult<T>>, options?: { label: string }): Promise<MutationResult<T>> {
    const result = await make(requestId, revision)
    setLastResult(result as MutationResult<unknown>)
    if (result.ok) {
      toast({ title: `${options?.label ?? '操作'}成功（${result.outcome === 'replayed' ? '请求号重放' : result.outcome === 'recovered' ? '按原请求号恢复' : '写入'}）`, status: 'success', duration: 2600 })
      refresh()
    } else if (result.outcome === 'conflict') {
      toast({
        title: '并发冲突：已有请求先写入',
        description: `先到者 ${result.winnerRequestId}（${result.winnerKind}），当前修订号 ${result.revision}。可沿用首次结果，或刷新后以新请求号重试。`,
        status: 'warning',
        duration: 6000,
        isClosable: true,
      })
    } else {
      toast({ title: '写入失败，状态未变更', description: `${result.message}（请求号 ${result.requestId}，可用该号恢复）`, status: 'error', duration: 6000, isClosable: true })
    }
    return result
  }

  function toggleWindow(id: string) {
    setWindowIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function doExport(snapshotId: string) {
    const pkg = await exportPackage.mutateAsync({ snapshotId })
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `审批包-${snapshotId}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    toast({ title: '审批包已按冻结数据导出', description: `快照 ${snapshotId}，含失效来源 ${String((pkg as any).invalidationSources.length)} 条`, status: 'success' })
  }

  const snapshots = view.data?.snapshots ?? []
  const releases = view.data?.releases ?? []
  const windows = view.data?.windows ?? []
  const comments = view.data?.comments ?? []
  const materials = view.data?.materials ?? []

  return (
    <Box>
      <Flex justify="space-between" mb={5} gap={4} direction={{ base: 'column', md: 'row' }}>
        <Box>
          <Text color="brand.600" fontSize="xs" fontWeight="bold">SNAPSHOT CHAIN & SIGN-OFF</Text>
          <Heading fontSize="3xl" my={1}>审批快照版本链</Heading>
          <Text color="gray.600">发起审批即冻结窗口、独占范围、未处理意见与物料；后续变化只失效受影响快照与未完成签署，两人同批签署先到者得。</Text>
        </Box>
        <HStack>
          <Badge colorScheme="purple" fontSize="sm" px={3} py={1}>修订号 r{revision}</Badge>
          <Button size="sm" variant="ghost" onClick={() => { reset.mutate(); refresh() }}>重置演示数据</Button>
        </HStack>
      </Flex>

      <Grid templateColumns={{ base: '1fr', xl: 'minmax(0,1.25fr) minmax(380px,.75fr)' }} gap={4}>
        {/* 左：版本链 */}
        <VStack spacing={4} align="stretch">
          {snapshots.length === 0 && <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={8} textAlign="center" color="gray.500">尚无审批快照，请在右侧发起审批。</Box>}
          {[...snapshots].reverse().map((snapshot) => {
            const meta = statusMeta[snapshot.status]
            const released = releases.find((item) => item.snapshotId === snapshot.id)
            return (
              <Box key={snapshot.id} bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={5} borderLeftWidth="4px" borderLeftColor={`${meta.color}.400`}>
                <Flex justify="space-between" align="flex-start" gap={3} wrap="wrap">
                  <Box>
                    <HStack mb={1}>
                      <Heading size="md">快照 #{snapshot.chainIndex} {snapshot.id}</Heading>
                      <Badge colorScheme={meta.color}>{meta.label}</Badge>
                      {released && <Badge colorScheme="green">正式版 {released.version}</Badge>}
                    </HStack>
                    <Text color="gray.500" fontSize="xs">
                      {snapshot.initiator} · {new Date(snapshot.createdAt).toLocaleString('zh-CN', { hour12: false })} · 冻结于 r{snapshot.revision}
                      {snapshot.prevId && <> · 前序 <Tag size="sm">{snapshot.prevId}</Tag></>}
                      {snapshot.successorId && <> · 后继 <Tag size="sm" colorScheme="blue">{snapshot.successorId}</Tag></>}
                    </Text>
                    <Text fontSize="sm" mt={1} color="gray.700">{snapshot.reason}</Text>
                  </Box>
                  <Text fontSize="10px" color="gray.400" fontFamily="monospace">{snapshot.checksum}</Text>
                </Flex>

                <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3} mt={3}>
                  <Box>
                    <Text fontSize="xs" color="gray.500" mb={1}>冻结窗口 / 独占范围</Text>
                    {snapshot.exclusivityScope.map((item) => (
                      <HStack key={item.windowId} fontSize="sm" mb={1}>
                        <Badge colorScheme={item.exclusive ? 'purple' : 'gray'}>{item.exclusive ? '独占' : '普通'}</Badge>
                        <Text>{item.windowId} · {item.channel} · {item.territory}</Text>
                      </HStack>
                    ))}
                  </Box>
                  <Box>
                    <Text fontSize="xs" color="gray.500" mb={1}>冻结未处理意见（{snapshot.openComments.length}）与物料（{snapshot.materials.length}）</Text>
                    {snapshot.openComments.map((item) => <Text key={item.id} fontSize="xs" color="gray.600" noOfLines={1}>· {item.id} {item.author}：{item.content}</Text>)}
                    {snapshot.materials.map((item) => <Text key={item.id} fontSize="xs" color="gray.600">· {item.id} {item.name} @ {item.version}</Text>)}
                  </Box>
                </Grid>

                <Divider my={3} />
                <Text fontSize="xs" color="gray.500" mb={2}>签署（{snapshot.signoffs.filter((s) => s.state === 'signed').length}/{snapshot.requiredReviewers.length}）</Text>
                <HStack spacing={2} mb={3} flexWrap="wrap">
                  {snapshot.signoffs.map((entry) => (
                    <Badge key={entry.reviewer} colorScheme={entry.state === 'signed' ? 'green' : entry.state === 'voided' ? 'red' : 'orange'}>
                      {entry.reviewer}：{entry.state === 'signed' ? '已签署' : entry.state === 'voided' ? `已作废（${entry.voidedByInvalidationId}）` : '待签署'}
                    </Badge>
                  ))}
                </HStack>

                {snapshot.invalidations.length > 0 && (
                  <Box bg="red.50" borderLeft="3px solid" borderLeftColor="red.400" p={3} mb={3} borderRadius="4px">
                    <Text fontWeight="700" fontSize="sm" mb={1}>失效来源（{snapshot.invalidations.length}）</Text>
                    {snapshot.invalidations.map((iv) => (
                      <Box key={iv.id} fontSize="xs" color="gray.700" mb={1}>
                        <Badge colorScheme="red" mr={1}>{sourceLabel[iv.source] ?? iv.source}</Badge>
                        {iv.refLabel}：{iv.detail}
                        {iv.voidedReviewers.length > 0 && <Text color="red.600">作废未完成签署：{iv.voidedReviewers.join('、')}</Text>}
                      </Box>
                    ))}
                  </Box>
                )}

                <HStack flexWrap="wrap" gap={2}>
                  {snapshot.status === 'active' && (
                    <>
                      {snapshot.requiredReviewers.map((name) => (
                        <Button key={name} size="sm" colorScheme="blue" variant="outline"
                          isDisabled={snapshot.signoffs.find((s) => s.reviewer === name)?.state === 'signed'}
                          onClick={() => void run(rid('req-sign'), (id, rev) => signoff.mutateAsync({ requestId: id, snapshotId: snapshot.id, reviewer: name, expectedRevision: rev }), { label: `${name} 签署` })}>
                          {name} 签署
                        </Button>
                      ))}
                      <Button size="sm" colorScheme="green"
                        onClick={() => void run(rid('req-rel'), (id, rev) => release.mutateAsync({ requestId: id, snapshotId: snapshot.id, expectedRevision: rev }), { label: '发布正式版' })}>
                        发布正式版
                      </Button>
                    </>
                  )}
                  {snapshot.status === 'invalidated' && (
                    <Button size="sm" colorScheme="orange"
                      onClick={() => void run(rid('req-resubmit'), (id, rev) => resubmit.mutateAsync({ requestId: id, invalidatedSnapshotId: snapshot.id, reason: '', reviewers: snapshot.requiredReviewers, expectedRevision: rev }), { label: '重新送审' })}>
                      清空失效项并重新送审
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void doExport(snapshot.id)}>导出冻结审批包</Button>
                </HStack>
              </Box>
            )
          })}

          {releases.length > 0 && (
            <Box bg="white" border="1px solid" borderColor="green.200" borderRadius="8px" p={4}>
              <Heading size="sm" mb={2} color="green.700">正式版本</Heading>
              {releases.map((item) => <Text key={item.id} fontSize="sm">· {item.version} ← {item.snapshotId}（{new Date(item.at).toLocaleString('zh-CN', { hour12: false })}）</Text>)}
            </Box>
          )}
        </VStack>

        {/* 右：操作区 */}
        <VStack spacing={4} align="stretch">
          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
            <Heading size="sm" mb={3}>发起审批（冻结当前数据）</Heading>
            <Text fontSize="xs" color="gray.500" mb={1}>选择窗口</Text>
            <VStack align="stretch" mb={3}>
              {windows.map((item) => (
                <HStack key={item.id} fontSize="sm">
                  <input type="checkbox" checked={windowIds.includes(item.id)} onChange={() => toggleWindow(item.id)} />
                  <Badge colorScheme={item.exclusive ? 'purple' : 'gray'}>{item.exclusive ? '独占' : '普通'}</Badge>
                  <Text>{item.id} {item.channel} {item.territory} {item.start}→{item.end}</Text>
                </HStack>
              ))}
            </VStack>
            <Text fontSize="xs" color="gray.500" mb={1}>审阅者（逗号分隔，至少 2 人）</Text>
            <Input size="sm" mb={3} value={reviewers} onChange={(e) => setReviewers(e.target.value)} />
            <Text fontSize="xs" color="gray.500" mb={1}>送审说明</Text>
            <Textarea size="sm" mb={3} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button w="100%" size="sm" colorScheme="blue" isDisabled={windowIds.length === 0}
              onClick={() => void run(rid('req-start'), (id, rev) => startApproval.mutateAsync({
                requestId: id, initiator: '章宁', reason, windowIds,
                reviewers: reviewers.split(',').map((s) => s.trim()).filter(Boolean),
                expectedRevision: rev,
              }), { label: '发起审批' })}>
              基于 r{revision} 发起审批
            </Button>
          </Box>

          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
            <Heading size="sm" mb={3}>送审后变化演练（触发失效传播）</Heading>
            <Text fontSize="xs" color="gray.500" mb={1}>改窗口日期 / 独占范围</Text>
            <Table size="sm" mb={2}>
              <Thead><Tr><Th>窗口</Th><Th>新开窗</Th><Th>独占</Th><Th></Th></Tr></Thead>
              <Tbody>
                {windows.map((item) => (
                  <Tr key={item.id}>
                    <Td fontSize="xs">{item.id}</Td>
                    <Td><Input size="xs" type="date" defaultValue={item.start} id={`win-start-${item.id}`} /></Td>
                    <Td>
                      <Select size="xs" id={`win-ex-${item.id}`} defaultValue={String(item.exclusive)}>
                        <option value="true">独占</option><option value="false">非独占</option>
                      </Select>
                    </Td>
                    <Td>
                      <Button size="xs" variant="outline" onClick={() => {
                        const start = (document.getElementById(`win-start-${item.id}`) as HTMLInputElement).value
                        const exclusive = (document.getElementById(`win-ex-${item.id}`) as HTMLSelectElement).value === 'true'
                        void run(rid('req-win'), (id, rev) => changeWindow.mutateAsync({
                          requestId: id, windowId: item.id,
                          patch: { ...(start !== item.start ? { start } : {}), ...(exclusive !== item.exclusive ? { exclusive } : {}) },
                          expectedRevision: rev,
                        }), { label: '窗口变更' })
                      }}>保存</Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>

            <Text fontSize="xs" color="gray.500" mb={1}>处理未决意见（命中冻结意见即失效对应快照）</Text>
            {comments.filter((c) => !c.resolved).map((item) => (
              <HStack key={item.id} justify="space-between" fontSize="xs" mb={1}>
                <Text noOfLines={1}>{item.id} {item.content}</Text>
                <Button size="xs" variant="ghost" onClick={() => void run(rid('req-cmt'), (id, rev) => resolveComment.mutateAsync({ requestId: id, commentId: item.id, expectedRevision: rev }), { label: '处理意见' })}>处理</Button>
              </HStack>
            ))}

            <Text fontSize="xs" color="gray.500" mt={2} mb={1}>物料升版</Text>
            {materials.map((item) => (
              <HStack key={item.id} justify="space-between" fontSize="xs" mb={1}>
                <Text noOfLines={1}>{item.id} {item.name} @ {item.version}</Text>
                <Button size="xs" variant="ghost" onClick={() => void run(rid('req-mat'), (id, rev) => changeMaterial.mutateAsync({ requestId: id, materialId: item.id, patch: { version: `${item.version}-p${revision + 1}` }, expectedRevision: rev }), { label: '物料升版' })}>升版</Button>
              </HStack>
            ))}
          </Box>

          <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
            <Heading size="sm" mb={2}>请求号 / 故障恢复</Heading>
            <Text fontSize="xs" color="gray.600" mb={2}>最近一次写入结果：</Text>
            <Box as="pre" fontSize="10px" bg="gray.50" p={2} borderRadius="4px" maxH="140px" overflow="auto">
              {lastResult ? JSON.stringify(lastResult, null, 1) : '（暂无）'}
            </Box>
            <CrashRecovery
              onRun={run}
              armCrash={armCrash.mutateAsync}
              startApproval={startApproval.mutateAsync}
            />
          </Box>
        </VStack>
      </Grid>
    </Box>
  )
}

/** 演示：先安排某请求号在提交点前故障 → 首次写入失败回滚 → 用同一请求号恢复 */
function CrashRecovery({ onRun, armCrash, startApproval }: {
  onRun: <T>(requestId: string, make: (id: string, rev: number) => Promise<MutationResult<T>>, options?: { label: string }) => Promise<MutationResult<T>>
  armCrash: (input: { requestId: string }) => Promise<unknown>
  startApproval: (input: { requestId: string; initiator: string; reason: string; windowIds: string[]; reviewers: string[]; expectedRevision: number }) => Promise<unknown>
}) {
  const [fixedId] = useState(`req-crash-${Math.random().toString(36).slice(2, 7)}`)
  const toast = useToast()
  const makeRequest = (id: string, rev: number) =>
    startApproval({ requestId: id, initiator: '章宁', reason: '故障恢复演练送审', windowIds: ['RW-101'], reviewers: ['黎清（法务）', '章宁（发行）'], expectedRevision: rev }) as Promise<MutationResult<unknown>>
  return (
    <VStack align="stretch" mt={3} spacing={2}>
      <Text fontSize="xs" color="gray.500">固定请求号：<Tag size="sm">{fixedId}</Tag></Text>
      <Button size="xs" colorScheme="red" variant="outline"
        onClick={async () => {
          await armCrash({ requestId: fixedId })
          const result = await onRun(fixedId, (id, rev) => makeRequest(id, rev), { label: '故障写入' })
          if (result.ok) return
          toast({ title: '已模拟提交前故障', description: '状态已回滚，点击“按原请求号恢复”。', status: 'info', duration: 4000 })
        }}>
        制造一次写入失败（发起审批）
      </Button>
      <Button size="xs" colorScheme="orange"
        onClick={() => void onRun(fixedId, (id, rev) => makeRequest(id, rev), { label: '恢复写入' })}>
        按原请求号恢复
      </Button>
    </VStack>
  )
}
