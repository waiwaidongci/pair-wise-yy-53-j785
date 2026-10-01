import { initTRPC } from '@trpc/server'
import { z } from 'zod'
import { initialComments, initialWindows } from '@/lib/mock-data'
import { findConflicts } from '@/lib/rules'
import { approvalEngine } from '@/server/approval'

const t = initTRPC.create()

const frozenMaterialSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['宣传物料', '地区物料包', '授权证明']),
  region: z.string(),
  note: z.string().optional(),
})

const windowInput = z.object({
  channel: z.string().min(2),
  start: z.string().date(),
  end: z.string().date(),
  exclusive: z.boolean(),
})

const draftInput = z.object({
  windows: z.array(z.any()),
  comments: z.array(z.any()),
  materials: z.array(frozenMaterialSchema),
  version: z.number(),
})

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

  approval: t.router({
    getState: t.procedure.query(() => approvalEngine.getState()),
    syncDraft: t.procedure.input(draftInput).mutation(({ input }) => approvalEngine.syncDraft(input)),
    initiate: t.procedure.input(draftInput).mutation(({ input }) => approvalEngine.initiate(input)),
    sign: t.procedure
      .input(z.object({ snapshotId: z.string(), role: z.enum(['法务', '发行']), reviewer: z.string().min(1), requestId: z.string().min(1) }))
      .mutation(({ input }) => approvalEngine.sign(input)),
    clearInvalid: t.procedure.mutation(() => approvalEngine.clearInvalid()),
    generateFormal: t.procedure.input(z.object({ snapshotId: z.string() })).mutation(({ input }) => approvalEngine.generateFormal(input.snapshotId)),
    exportPackage: t.procedure.input(z.object({ snapshotId: z.string() })).query(({ input }) => approvalEngine.exportPackage(input.snapshotId)),
    reset: t.procedure.mutation(() => approvalEngine.reset()),
  }),
})

export type AppRouter = typeof appRouter
