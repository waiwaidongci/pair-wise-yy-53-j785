import { ApprovalEngine } from '@/lib/approval-engine'
import { defaultReviewers, initialComments, initialMaterials, initialWindows } from '@/lib/mock-data'

/**
 * 服务端单例：真实部署中这里换成数据库事务 + 幂等表，
 * 内存版保持同样的语义：单写入队列、请求号幂等、提交点原子性。
 */

declare global {
  // eslint-disable-next-line no-var
  var __approvalEngine: ApprovalEngine | undefined
  // eslint-disable-next-line no-var
  var __crashNextRequestId: string | undefined
}

export function getEngine(): ApprovalEngine {
  if (!globalThis.__approvalEngine) {
    globalThis.__approvalEngine = new ApprovalEngine({
      windows: initialWindows,
      comments: initialComments,
      materials: initialMaterials,
      defaultReviewers,
      crashBeforeCommit: ({ requestId }) => {
        if (globalThis.__crashNextRequestId && globalThis.__crashNextRequestId === requestId) {
          globalThis.__crashNextRequestId = undefined
          return true
        }
        return false
      },
    })
  }
  return globalThis.__approvalEngine
}

/** 安排下一个指定请求号在提交前故障（演示写入失败恢复） */
export function armCrash(requestId: string) {
  globalThis.__crashNextRequestId = requestId
}

export function resetEngine(): ApprovalEngine {
  globalThis.__approvalEngine = new ApprovalEngine({
    windows: initialWindows,
    comments: initialComments,
    materials: initialMaterials,
    defaultReviewers,
  })
  globalThis.__crashNextRequestId = undefined
  return globalThis.__approvalEngine
}

export function newRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
