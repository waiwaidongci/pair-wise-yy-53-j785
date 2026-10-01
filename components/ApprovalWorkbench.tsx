'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Box, Flex, Heading, Text, Badge, Button, Grid, useToast, VStack, HStack, Divider,
  List, ListItem, Tag, TagLabel, Wrap, WrapItem, Select, Icon,
} from '@chakra-ui/react'
import { trpc } from '@/trpc/client'
import { useRightsStore } from '@/store/rights'
import { materialCatalog } from '@/lib/mock-data'
import type { SignatureRole, Snapshot } from '@/lib/types'

const roleReviewers: Record<SignatureRole, string> = { 法务: '黎清', 发行: '章宁' }

function StatusBadge({ status }: { status: Snapshot['status'] }) {
  const scheme = status === '正式' ? 'green' : status === '有效' ? 'blue' : 'red'
  return <Badge colorScheme={scheme}>{status}</Badge>
}

function SignatureBadge({ status }: { status: '待签署' | '已签署' | '已失效' }) {
  const scheme = status === '已签署' ? 'green' : status === '已失效' ? 'red' : 'gray'
  return <Badge colorScheme={scheme}>{status}</Badge>
}

export function ApprovalWorkbench() {
  const toast = useToast()
  const utils = trpc.useUtils()
  const windows = useRightsStore((state) => state.windows)
  const comments = useRightsStore((state) => state.comments)
  const materials = useRightsStore((state) => state.materials)
  const draftVersion = useRightsStore((state) => state.version)
  const addMaterial = useRightsStore((state) => state.addMaterial)

  const stateQuery = trpc.approval.getState.useQuery(undefined, { refetchOnWindowFocus: false })
  const initiate = trpc.approval.initiate.useMutation({ onSuccess: () => utils.approval.getState.invalidate() })
  const signMutation = trpc.approval.sign.useMutation({ onSuccess: () => utils.approval.getState.invalidate() })
  const clearInvalid = trpc.approval.clearInvalid.useMutation({ onSuccess: () => utils.approval.getState.invalidate() })
  const generateFormal = trpc.approval.generateFormal.useMutation({ onSuccess: () => utils.approval.getState.invalidate() })

  const [materialPick, setMaterialPick] = useState(0)
  const state = stateQuery.data
  const current = state?.currentSnapshot ?? null
  const snapshots = state?.snapshots ?? []
  const invalidItems = state?.invalidItems ?? []
  const canGenerate = state?.canGenerate ?? { ok: false }

  const draft = useMemo(() => ({ windows, comments, materials, version: draftVersion }), [windows, comments, materials, draftVersion])

  const refresh = useCallback(() => utils.approval.getState.invalidate(), [utils])

  const handleInitiate = useCallback(async () => {
    try {
      await initiate.mutateAsync(draft)
      toast({ title: '审批已发起', description: '窗口、独占范围、未处理意见与物料已冻结为快照。', status: 'success' })
    } catch (err) {
      toast({ title: '发起失败', description: (err as Error).message, status: 'error' })
    }
  }, [initiate, draft, toast])

  // 签署：先到者写入；冲突时凭原请求号重试，重试沿用第一次结果
  const signWithRetry = useCallback(
    async (snapshotId: string, role: SignatureRole, reviewer: string, requestId?: string) => {
      const rid = requestId ?? `req-${snapshotId}-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      try {
        return await signMutation.mutateAsync({ snapshotId, role, reviewer, requestId: rid })
      } catch (err) {
        if ((err as { data?: { code?: string } })?.data?.code === 'CONFLICT') {
          toast({ title: '检测到并发冲突', description: '先到者已写入，正在凭原请求号重试…', status: 'info' })
          const retried = await signMutation.mutateAsync({ snapshotId, role, reviewer, requestId: rid })
          toast({ title: '重试完成', description: retried?.adopted ? '已沿用第一次签署结果。' : '签署成功。', status: 'success' })
          return retried
        }
        throw err
      }
    },
    [signMutation, toast],
  )

  const handleSign = useCallback(
    async (snapshotId: string, role: SignatureRole) => {
      try {
        await signWithRetry(snapshotId, role, roleReviewers[role])
        toast({ title: '签署成功', description: `${roleReviewers[role]} 已签署${role}。`, status: 'success' })
      } catch (err) {
        toast({ title: '签署失败', description: (err as Error).message, status: 'error' })
      }
    },
    [signWithRetry, toast],
  )

  // 模拟两位审阅者同时提交同一快照：先到者写入，后到者见冲突并重试沿用第一次结果
  const handleRace = useCallback(async (snapshotId: string) => {
    const reqA = `race-${snapshotId}-A-${Date.now()}`
    const reqB = `race-${snapshotId}-B-${Date.now()}`
    toast({ title: '模拟两位审阅者同时签署同一快照', description: '先到者写入，后到者将看到冲突并重试。', status: 'info' })
    const [a, b] = await Promise.allSettled([
      signMutation.mutateAsync({ snapshotId, role: '法务', reviewer: '黎清（法务）', requestId: reqA }),
      signMutation.mutateAsync({ snapshotId, role: '法务', reviewer: '章宁（发行）', requestId: reqB }),
    ])
    const retry = async (r: PromiseSettledResult<unknown>, requestId: string, reviewer: string) => {
      if (r.status === 'rejected' && (r.reason as { data?: { code?: string } })?.data?.code === 'CONFLICT') {
        toast({ title: '后到者看到冲突', description: `请求号 ${requestId} 冲突，正在重试…`, status: 'warning' })
        const retried = await signMutation.mutateAsync({ snapshotId, role: '法务', reviewer, requestId })
        toast({ title: '重试沿用第一次结果', description: `已采用先到者的签署（adopted=${String(retried?.adopted ?? true)}）。`, status: 'success' })
        return retried
      }
      if (r.status === 'fulfilled') toast({ title: '先到者已写入', description: '签署成功。', status: 'success' })
      return null
    }
    await retry(a, reqA, '黎清（法务）')
    await retry(b, reqB, '章宁（发行）')
    refresh()
  }, [signMutation, toast, refresh])

  const handleGenerate = useCallback(async (snapshotId: string) => {
    try {
      await generateFormal.mutateAsync({ snapshotId })
      toast({ title: '已生成正式版本', description: '审批包按冻结数据锁定，可导出追溯。', status: 'success' })
    } catch (err) {
      toast({ title: '无法生成正式版本', description: (err as Error).message, status: 'error' })
    }
  }, [generateFormal, toast])

  const handleExport = useCallback(async (snapshotId: string) => {
    try {
      const pkg = await utils.approval.exportPackage.fetch({ snapshotId })
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `发行权审批包-${pkg.snapshotId}-v${pkg.packageVersion}.json`
      link.click()
      URL.revokeObjectURL(link.href)
      toast({ title: '审批包已导出', description: '按冻结数据导出，并列出失效来源。', status: 'success' })
    } catch (err) {
      toast({ title: '导出失败', description: (err as Error).message, status: 'error' })
    }
  }, [utils, toast])

  const handleAddMaterial = useCallback(() => {
    const picked = materialCatalog[materialPick]
    if (!picked) return
    addMaterial({ ...picked, id: `MT-${String(Date.now()).slice(-6)}` })
    toast({ title: '已新增物料', description: '草稿版本变化将使当前快照失效。', status: 'info' })
  }, [materialPick, addMaterial, toast])

  return (
    <VStack align="stretch" gap={4}>
      {/* 发起审批 */}
      <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
        <Flex justify="space-between" align="center" gap={4} flexWrap="wrap">
          <Box>
            <Heading size="md">发起审批 · 冻结快照</Heading>
            <Text color="gray.500" fontSize="sm" mt={1}>
              当前草稿 <Badge>v{draftVersion}</Badge> · 窗口 {windows.length} · 未处理意见 {comments.filter((c) => !c.resolved).length} · 物料 {materials.length}
            </Text>
          </Box>
          <HStack>
            <Button colorScheme="blue" onClick={handleInitiate} isLoading={initiate.isPending}>发起审批并冻结</Button>
          </HStack>
        </Flex>
        <Divider my={3} />
        <Flex gap={2} align="center" flexWrap="wrap">
          <Text fontSize="sm" color="gray.600">新增物料以触发失效：</Text>
          <Select size="sm" maxW="260px" value={materialPick} onChange={(e) => setMaterialPick(Number(e.target.value))}>
            {materialCatalog.map((m, i) => <option key={m.name} value={i}>{m.name}</option>)}
          </Select>
          <Button size="sm" variant="outline" onClick={handleAddMaterial}>新增物料</Button>
        </Flex>
      </Box>

      {/* 失效项横幅 */}
      {invalidItems.length > 0 && (
        <Box bg="red.50" border="1px solid" borderColor="red.200" borderRadius="8px" p={4}>
          <Flex justify="space-between" align="center" mb={2}>
            <HStack><Icon viewBox="0 0 24 24" color="red.500"><path fill="currentColor" d="M12 2L1 21h22L12 2zm0 6l7.5 13h-15L12 8zm-1 4v4h2v-4h-2zm0 5v2h2v-2h-2z" /></Icon><Heading size="sm" color="red.700">存在 {invalidItems.length} 项失效快照</Heading></HStack>
            <Button size="sm" colorScheme="red" variant="outline" onClick={() => clearInvalid.mutateAsync().then(() => refresh())}>清空失效项</Button>
          </Flex>
          {invalidItems.map((item) => (
            <Box key={item.snapshotId} fontSize="sm" color="red.700" mb={1}>
              <Text fontWeight="600">{item.snapshotId}（v{item.version}）失效来源：</Text>
              <List spacing={0} pl={4} styleType="disc">
                {item.reasons.map((r, i) => (
                  <ListItem key={i}>{r.type} · {r.targetLabel}{r.field ? `（${r.field}${r.from ? `：${r.from} → ${r.to ?? ''}` : ''}）` : ''}</ListItem>
                ))}
              </List>
            </Box>
          ))}
        </Box>
      )}

      {/* 当前快照 */}
      {current ? (
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
          <Flex justify="space-between" align="center" mb={3} flexWrap="wrap" gap={2}>
            <HStack>
              <Heading size="md">当前快照 {current.id}</Heading>
              <StatusBadge status={current.status} />
              <Badge variant="outline">v{current.version}</Badge>
            </HStack>
            <HStack>
              <Button size="sm" variant="outline" onClick={() => handleRace(current.id)} isLoading={signMutation.isPending}>模拟两位审阅者同时签署</Button>
              <Button size="sm" colorScheme="green" isDisabled={!canGenerate.ok} onClick={() => handleGenerate(current.id)} isLoading={generateFormal.isPending}>生成正式版本</Button>
              <Button size="sm" colorScheme="blue" variant="outline" onClick={() => handleExport(current.id)}>导出审批包</Button>
            </HStack>
          </Flex>
          {!canGenerate.ok && <Text fontSize="sm" color="orange.600" mb={3}>生成受限：{canGenerate.reason}</Text>}

          <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={4}>
            <Box>
              <Text fontWeight="600" fontSize="sm" mb={2}>冻结窗口（{current.frozenWindows.length}）</Text>
              <Wrap spacing={1} mb={3}>{current.frozenWindows.map((w) => (
                <WrapItem key={w.id}><Tag size="sm" colorScheme={w.exclusive ? 'purple' : 'gray'}><TagLabel>{w.channel} · {w.start}→{w.end}{w.exclusive ? ' · 独占' : ''}</TagLabel></Tag></WrapItem>
              ))}</Wrap>
              <Text fontWeight="600" fontSize="sm" mb={2}>独占范围（{current.exclusiveScope.length}）</Text>
              <Wrap spacing={1} mb={3}>{current.exclusiveScope.map((e) => (
                <WrapItem key={e.windowId}><Tag size="sm" colorScheme="purple"><TagLabel>{e.channel} · {e.territory}</TagLabel></Tag></WrapItem>
              ))}</Wrap>
            </Box>
            <Box>
              <Text fontWeight="600" fontSize="sm" mb={2}>冻结未处理意见（{current.frozenComments.length}）</Text>
              <List spacing={1} mb={3}>{current.frozenComments.map((c) => (
                <ListItem key={c.id} fontSize="sm" color="gray.700">{c.author} · {c.anchor}：{c.content}</ListItem>
              ))}</List>
              <Text fontWeight="600" fontSize="sm" mb={2}>冻结物料（{current.frozenMaterials.length}）</Text>
              <Wrap spacing={1}>{current.frozenMaterials.map((m) => (
                <WrapItem key={m.id}><Tag size="sm" colorScheme="cyan"><TagLabel>{m.name} · {m.region}</TagLabel></Tag></WrapItem>
              ))}</Wrap>
            </Box>
          </Grid>

          <Divider my={3} />
          <Text fontWeight="600" fontSize="sm" mb={2}>签署（先到者写入，冲突后凭请求号重试沿用第一次结果）</Text>
          <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={3}>
            {current.signatures.map((sig) => (
              <Box key={sig.id} border="1px solid" borderColor="gray.200" borderRadius="6px" p={3}>
                <Flex justify="space-between" align="center">
                  <HStack><Text fontWeight="700" fontSize="sm">{sig.role}</Text><SignatureBadge status={sig.status} /></HStack>
                  {sig.status === '待签署' && <Button size="xs" colorScheme="blue" onClick={() => handleSign(current.id, sig.role)}>签署</Button>}
                </Flex>
                {sig.status === '已签署' ? (
                  <Text fontSize="xs" color="gray.600" mt={1}>{sig.reviewer} · {sig.signedAt ? new Date(sig.signedAt).toLocaleString('zh-CN') : ''}{sig.requestId ? ` · 请求号 ${sig.requestId}` : ''}{sig.adopted ? ' · 沿用先到结果' : ''}</Text>
                ) : sig.status === '已失效' ? (
                  <Text fontSize="xs" color="red.500" mt={1}>未完成签署随快照失效</Text>
                ) : (
                  <Text fontSize="xs" color="gray.400" mt={1}>待签署</Text>
                )}
              </Box>
            ))}
          </Grid>
        </Box>
      ) : (
        <Box bg="white" border="1px dashed" borderColor="gray.300" borderRadius="8px" p={6} textAlign="center">
          <Text color="gray.500">尚未发起审批。点击「发起审批并冻结」生成快照，冻结窗口、独占范围、未处理意见与物料。</Text>
        </Box>
      )}

      {/* 版本链历史 */}
      {snapshots.length > 0 && (
        <Box bg="white" border="1px solid" borderColor="gray.200" borderRadius="8px" p={4}>
          <Heading size="sm" mb={3}>版本链（{snapshots.length}）</Heading>
          <VStack align="stretch" gap={2}>
            {snapshots.map((snap) => (
              <Box key={snap.id} border="1px solid" borderColor="gray.100" borderRadius="6px" p={3} bg={snap.status === '正式' ? 'green.50' : snap.status === '失效' ? 'red.50' : 'white'}>
                <Flex justify="space-between" align="center" flexWrap="wrap" gap={2}>
                  <HStack>
                    <Text fontWeight="700" fontSize="sm">{snap.id}</Text>
                    <StatusBadge status={snap.status} />
                    <Badge variant="outline">v{snap.version}</Badge>
                    {snap.formalVersion ? <Badge colorScheme="green">正式版 v{snap.formalVersion}</Badge> : null}
                    {snap.parentSnapshotId ? <Text fontSize="xs" color="gray.400">← {snap.parentSnapshotId}</Text> : null}
                  </HStack>
                  <HStack>
                    <Button size="xs" variant="outline" onClick={() => handleExport(snap.id)}>导出</Button>
                  </HStack>
                </Flex>
                <Text fontSize="xs" color="gray.500" mt={1}>
                  冻结于 {new Date(snap.frozenAt).toLocaleString('zh-CN')} · 窗口 {snap.frozenWindows.length} · 意见 {snap.frozenComments.length} · 物料 {snap.frozenMaterials.length}
                </Text>
                {snap.status === '失效' && snap.invalidReasons.length > 0 && (
                  <Text fontSize="xs" color="red.600" mt={1}>失效来源：{snap.invalidReasons.map((r) => `${r.type}·${r.targetLabel}`).join('；')}</Text>
                )}
                {snap.signatures.some((s) => s.status === '已签署') && (
                  <Text fontSize="xs" color="gray.600" mt={1}>签署：{snap.signatures.filter((s) => s.status === '已签署').map((s) => `${s.role} ${s.reviewer}`).join('、')}</Text>
                )}
              </Box>
            ))}
          </VStack>
        </Box>
      )}
    </VStack>
  )
}
