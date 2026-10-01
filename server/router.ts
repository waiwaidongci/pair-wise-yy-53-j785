import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { initialComments, initialWindows } from '@/lib/mock-data'
import { findConflicts } from '@/lib/rules'
import { armCrash, getEngine, newRequestId, resetEngine } from './approval-store'

const t = initTRPC.create()
const windowInput = z.object({
  channel: z.string().min(2),
  start: z.string().date(),
  end: z.string().date(),
  exclusive: z.boolean(),
})

const expectedRevision = z.number().int().nonnegative()
const requestId = z.string().min(4).optional()

export const appRouter = t.router({
  catalog: t.procedure.query(() => ({ works: ['W-001', 'W-002'], channels: ['星海影院', '云帆视频', '南华卫视', '海岛航空', '环球新媒体'] })),
  windows: t.procedure.query(() => initialWindows),
  conflicts: t.procedure.query(() => findConflicts(initialWindows)),
  validateWindow: t.procedure.input(windowInput).mutation(({ input }) => {
    if (new Date(input.end) < new Date(input.start)) return { valid: false, message: '窗口结束日期不能早于开始日期。' }
    const collision = initialWindows.find((item) => item.channel === input.channel && input.start <= item.end && item.start <= input.end)
    return collision ? { valid: false, message: `与现有窗口 ${collision.id} 重叠，请调整窗口或明确优先级。` } : { valid: true, message: '窗口结构校验通过。' }
  }),
  comments: t.procedure.query(() => initialComments),

  // —— 版本链视图：修订号 + 全部快照（含失效/取代/发布）+ 正式版本 ——
  approvalView: t.procedure.query(() => getEngine().view),

  exportPackage: t.procedure.input(z.object({ snapshotId: z.string() })).mutation(({ input }) => getEngine().exportPackage(input.snapshotId)),

  startApproval: t.procedure
    .input(z.object({
      requestId,
      initiator: z.string().min(1),
      reason: z.string().min(1),
      windowIds: z.array(z.string()).min(1),
      reviewers: z.array(z.string()).default([]),
      expectedRevision,
    }))
    .mutation(({ input }) => getEngine().execute({
      kind: 'startApproval',
      requestId: input.requestId ?? newRequestId('req-start'),
      initiator: input.initiator,
      reason: input.reason,
      windowIds: input.windowIds,
      reviewers: input.reviewers,
      expectedRevision: input.expectedRevision,
    })),

  signoff: t.procedure
    .input(z.object({ requestId, snapshotId: z.string(), reviewer: z.string().min(1), expectedRevision }))
    .mutation(({ input }) => getEngine().execute({
      kind: 'signoff',
      requestId: input.requestId ?? newRequestId('req-sign'),
      snapshotId: input.snapshotId,
      reviewer: input.reviewer,
      expectedRevision: input.expectedRevision,
    })),

  resubmit: t.procedure
    .input(z.object({ requestId, invalidatedSnapshotId: z.string(), reason: z.string().default(''), reviewers: z.array(z.string()).default([]), expectedRevision }))
    .mutation(({ input }) => getEngine().execute({
      kind: 'resubmit',
      requestId: input.requestId ?? newRequestId('req-resubmit'),
      invalidatedSnapshotId: input.invalidatedSnapshotId,
      reason: input.reason,
      reviewers: input.reviewers,
      expectedRevision: input.expectedRevision,
    })),

  release: t.procedure
    .input(z.object({ requestId, snapshotId: z.string(), version: z.string().optional(), expectedRevision }))
    .mutation(({ input }) => getEngine().execute({
      kind: 'release',
      requestId: input.requestId ?? newRequestId('req-rel'),
      snapshotId: input.snapshotId,
      version: input.version,
      expectedRevision: input.expectedRevision,
    })),

  changeWindow: t.procedure
    .input(z.object({
      requestId,
      windowId: z.string(),
      patch: z.object({
        start: z.string().date().optional(),
        end: z.string().date().optional(),
        channel: z.string().optional(),
        territory: z.string().optional(),
        rights: z.string().optional(),
        exclusive: z.boolean().optional(),
        priority: z.number().int().optional(),
        sublicense: z.boolean().optional(),
      }),
      expectedRevision,
    }))
    .mutation(({ input }) => getEngine().execute({
      kind: 'windowChange',
      requestId: input.requestId ?? newRequestId('req-win'),
      windowId: input.windowId,
      patch: input.patch,
      expectedRevision: input.expectedRevision,
    })),

  resolveComment: t.procedure
    .input(z.object({ requestId, commentId: z.string(), expectedRevision }))
    .mutation(({ input }) => getEngine().execute({
      kind: 'commentResolve',
      requestId: input.requestId ?? newRequestId('req-cmt'),
      commentId: input.commentId,
      expectedRevision: input.expectedRevision,
    })),

  changeMaterial: t.procedure
    .input(z.object({
      requestId,
      materialId: z.string(),
      patch: z.object({ name: z.string().optional(), version: z.string().optional(), windowIds: z.array(z.string()).optional() }),
      expectedRevision,
    }))
    .mutation(({ input }) => getEngine().execute({
      kind: 'materialChange',
      requestId: input.requestId ?? newRequestId('req-mat'),
      materialId: input.materialId,
      patch: input.patch,
      expectedRevision: input.expectedRevision,
    })),

  /** 安排指定请求号在提交点前故障，用于演示「写入失败 → 原请求号恢复」 */
  armCrash: t.procedure.input(z.object({ requestId: z.string().min(4) })).mutation(({ input }) => {
    armCrash(input.requestId)
    return { armed: true, requestId: input.requestId }
  }),

  resetApprovals: t.procedure.mutation(() => {
    resetEngine()
    return getEngine().view
  }),
})

export type AppRouter = typeof appRouter
