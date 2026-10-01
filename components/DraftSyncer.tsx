'use client'

import { useEffect, useRef } from 'react'
import { trpc } from '@/trpc/client'
import { useRightsStore } from '@/store/rights'

// 监听草稿版本变化，把窗口 / 独占范围 / 未处理意见 / 物料同步到服务端审批引擎。
// 服务端 diff 后让受影响的快照和未完成签署失效，正式快照与已完成签署继续有效。
export function DraftSyncer() {
  const windows = useRightsStore((state) => state.windows)
  const comments = useRightsStore((state) => state.comments)
  const materials = useRightsStore((state) => state.materials)
  const version = useRightsStore((state) => state.version)
  const syncDraft = trpc.approval.syncDraft.useMutation()
  const firstRef = useRef(true)

  useEffect(() => {
    // 首次挂载建立服务端基线；之后每次版本变化同步并做失效传播
    if (firstRef.current) {
      firstRef.current = false
    }
    syncDraft.mutate({ windows, comments, materials, version })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  return null
}
