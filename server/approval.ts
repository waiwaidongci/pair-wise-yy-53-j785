import { TRPCError } from '@trpc/server'
import type {
  FrozenMaterial,
  InvalidationReason,
  LicenseWindow,
  RightsComment,
  Signature,
  SignatureRole,
  Snapshot,
} from '@/lib/types'

// 审批引擎：版本链 + 冻结快照 + 失效传播 + 先到者写入 + 按请求号幂等恢复
// 所有状态保存在服务端内存，两位审阅者看到同一份权威快照。

interface DraftInput {
  windows: LicenseWindow[]
  comments: RightsComment[]
  materials: FrozenMaterial[]
  version: number
}

interface IdempotencyRecord {
  snapshotId: string
  signature: Signature
}

export interface SignResult {
  snapshotId: string
  signature: Signature
  idempotent: boolean
  adopted?: boolean
}

interface ApprovalState {
  initialized: boolean
  draftVersion: number
  draftWindows: LicenseWindow[]
  draftComments: RightsComment[]
  draftMaterials: FrozenMaterial[]
  snapshots: Snapshot[]
  snapshotSeq: number
  // 请求号 -> 已提交结果（幂等：重试沿用第一次结果）
  idempotency: Map<string, IdempotencyRecord>
  // 请求号 -> 进行中的签署（并发去重：同一请求号重试等待同一结果）
  inFlight: Map<string, Promise<SignResult>>
  // 已发生过冲突的请求号（重试时沿用先到者结果）
  conflicted: Set<string>
  formalCount: number
}

const state: ApprovalState = {
  initialized: false,
  draftVersion: 0,
  draftWindows: [],
  draftComments: [],
  draftMaterials: [],
  snapshots: [],
  snapshotSeq: 0,
  idempotency: new Map(),
  inFlight: new Map(),
  conflicted: new Set(),
  formalCount: 0,
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function unresolvedComments(comments: RightsComment[]): RightsComment[] {
  return comments.filter((comment) => !comment.resolved)
}

// ---- 差异检测：找出窗口 / 独占范围 / 意见 / 物料的变化 ----

function diffWindows(prev: LicenseWindow[], next: LicenseWindow[]): InvalidationReason[] {
  const reasons: InvalidationReason[] = []
  const prevMap = new Map(prev.map((w) => [w.id, w]))
  const nextMap = new Map(next.map((w) => [w.id, w]))
  for (const w of next) {
    const p = prevMap.get(w.id)
    const label = `${w.work} · ${w.channel}`
    if (!p) {
      reasons.push({ atVersion: 0, type: '窗口新增', targetId: w.id, targetLabel: label })
      continue
    }
    if (p.start !== w.start) reasons.push({ atVersion: 0, type: '窗口变更', targetId: w.id, targetLabel: label, field: '开始日期', from: p.start, to: w.start })
    if (p.end !== w.end) reasons.push({ atVersion: 0, type: '窗口变更', targetId: w.id, targetLabel: label, field: '结束日期', from: p.end, to: w.end })
    if (p.exclusive !== w.exclusive) reasons.push({ atVersion: 0, type: '独占范围变更', targetId: w.id, targetLabel: label, field: '独占', from: String(p.exclusive), to: String(w.exclusive) })
    if (p.territory !== w.territory) reasons.push({ atVersion: 0, type: '窗口变更', targetId: w.id, targetLabel: label, field: '地区', from: p.territory, to: w.territory })
    if (p.rights !== w.rights) reasons.push({ atVersion: 0, type: '窗口变更', targetId: w.id, targetLabel: label, field: '权利类型', from: p.rights, to: w.rights })
    if (p.channel !== w.channel) reasons.push({ atVersion: 0, type: '窗口变更', targetId: w.id, targetLabel: label, field: '渠道', from: p.channel, to: w.channel })
    if (p.sublicense !== w.sublicense) reasons.push({ atVersion: 0, type: '窗口变更', targetId: w.id, targetLabel: label, field: '次级授权', from: String(p.sublicense), to: String(w.sublicense) })
  }
  for (const p of prev) {
    if (!nextMap.has(p.id)) reasons.push({ atVersion: 0, type: '窗口删除', targetId: p.id, targetLabel: `${p.work} · ${p.channel}` })
  }
  return reasons
}

function diffComments(prev: RightsComment[], next: RightsComment[]): InvalidationReason[] {
  const reasons: InvalidationReason[] = []
  const prevMap = new Map(prev.map((c) => [c.id, c]))
  for (const c of next) {
    const p = prevMap.get(c.id)
    const label = `${c.author} · ${c.anchor}`
    if (!p) {
      reasons.push({ atVersion: 0, type: '意见处理', targetId: c.id, targetLabel: label, field: '新增意见' })
    } else if (p.resolved !== c.resolved && c.resolved) {
      reasons.push({ atVersion: 0, type: '意见处理', targetId: c.id, targetLabel: label, field: 'resolved', from: '未处理', to: '已处理' })
    }
  }
  return reasons
}

function diffMaterials(prev: FrozenMaterial[], next: FrozenMaterial[]): InvalidationReason[] {
  const reasons: InvalidationReason[] = []
  const prevMap = new Map(prev.map((m) => [m.id, m]))
  const nextMap = new Map(next.map((m) => [m.id, m]))
  for (const m of next) {
    const p = prevMap.get(m.id)
    if (!p) {
      reasons.push({ atVersion: 0, type: '物料变更', targetId: m.id, targetLabel: m.name, field: '新增物料' })
    } else if (p.name !== m.name || p.region !== m.region || p.type !== m.type || p.note !== m.note) {
      reasons.push({ atVersion: 0, type: '物料变更', targetId: m.id, targetLabel: m.name, field: '物料信息', from: `${p.name}/${p.region}`, to: `${m.name}/${m.region}` })
    }
  }
  for (const p of prev) {
    if (!nextMap.has(p.id)) reasons.push({ atVersion: 0, type: '物料变更', targetId: p.id, targetLabel: p.name, field: '删除物料' })
  }
  return reasons
}

// ---- 失效传播：受影响的快照失效，未完成签署失效，已完成签署保留，正式快照永久有效 ----

function invalidateAffected(reasons: InvalidationReason[], newVersion: number): void {
  if (reasons.length === 0) return
  for (const reason of reasons) reason.atVersion = newVersion
  for (const snapshot of state.snapshots) {
    if (snapshot.status !== '有效') continue // 正式快照永久有效，已失效快照不重复处理
    // 快照冻结的是整份草案，任一变化都使当前待审批快照失效
    snapshot.status = '失效'
    snapshot.invalidReasons.push(...clone(reasons))
    for (const signature of snapshot.signatures) {
      if (signature.status === '待签署') signature.status = '已失效'
      // 已签署保留（其他签署继续有效），作为历史签署记录
    }
  }
}

function collectInvalidItems(): { snapshotId: string; version: number; reasons: InvalidationReason[] }[] {
  return state.snapshots
    .filter((s) => s.status === '失效')
    .map((s) => ({ snapshotId: s.id, version: s.version, reasons: clone(s.invalidReasons) }))
}

function checkCanGenerate(): { ok: boolean; reason?: string } {
  const invalid = state.snapshots.filter((s) => s.status === '失效')
  if (invalid.length > 0) return { ok: false, reason: `存在 ${invalid.length} 项失效快照未清空` }
  const current = state.snapshots.find((s) => s.status === '有效')
  if (!current) return { ok: false, reason: '没有待审批的有效快照' }
  const unsigned = current.signatures.filter((s) => s.status !== '已签署')
  if (unsigned.length > 0) return { ok: false, reason: `签署不完整：${unsigned.map((s) => s.role).join('、')} 尚未签署` }
  return { ok: true }
}

export const approvalEngine = {
  getState() {
    return {
      initialized: state.initialized,
      draftVersion: state.draftVersion,
      snapshots: clone(state.snapshots),
      currentSnapshot: clone(state.snapshots.find((s) => s.status === '有效') ?? null),
      invalidItems: collectInvalidItems(),
      canGenerate: checkCanGenerate(),
    }
  },

  // 客户端草稿变化后同步到服务端；服务端 diff 并做失效传播
  syncDraft(draft: DraftInput) {
    if (!state.initialized) {
      state.initialized = true
      state.draftVersion = draft.version
      state.draftWindows = clone(draft.windows)
      state.draftComments = clone(draft.comments)
      state.draftMaterials = clone(draft.materials)
      return this.getState()
    }
    if (draft.version === state.draftVersion) return this.getState()
    const reasons = [
      ...diffWindows(state.draftWindows, draft.windows),
      ...diffComments(state.draftComments, draft.comments),
      ...diffMaterials(state.draftMaterials, draft.materials),
    ]
    invalidateAffected(reasons, draft.version)
    state.draftVersion = draft.version
    state.draftWindows = clone(draft.windows)
    state.draftComments = clone(draft.comments)
    state.draftMaterials = clone(draft.materials)
    return this.getState()
  },

  // 发起审批：冻结窗口、独占范围、未处理意见和物料
  initiate(draft: DraftInput) {
    if (!state.initialized) {
      state.initialized = true
      state.draftVersion = draft.version
      state.draftWindows = clone(draft.windows)
      state.draftComments = clone(draft.comments)
      state.draftMaterials = clone(draft.materials)
    }
    if (draft.version !== state.draftVersion) this.syncDraft(draft)
    // 重新发起：旧的待审批快照失效（正式快照不受影响）
    for (const snapshot of state.snapshots) {
      if (snapshot.status === '有效') {
        snapshot.status = '失效'
        snapshot.invalidReasons.push({ atVersion: state.draftVersion, type: '窗口变更', targetId: '*', targetLabel: '重新发起审批', field: 'superseded' })
        for (const signature of snapshot.signatures) {
          if (signature.status === '待签署') signature.status = '已失效'
        }
      }
    }
    const id = `SP-${String(state.snapshotSeq + 1).padStart(3, '0')}`
    state.snapshotSeq += 1
    const snapshot: Snapshot = {
      id,
      version: state.draftVersion,
      status: '有效',
      frozenAt: new Date().toISOString(),
      frozenWindows: clone(state.draftWindows),
      frozenComments: clone(unresolvedComments(state.draftComments)),
      frozenMaterials: clone(state.draftMaterials),
      exclusiveScope: state.draftWindows
        .filter((w) => w.exclusive)
        .map((w) => ({ windowId: w.id, channel: w.channel, territory: w.territory, exclusive: w.exclusive })),
      requiredRoles: ['法务', '发行'],
      signatures: [
        { id: `SG-${id}-法务`, role: '法务', reviewer: '', status: '待签署' },
        { id: `SG-${id}-发行`, role: '发行', reviewer: '', status: '待签署' },
      ],
      invalidReasons: [],
      parentSnapshotId: state.snapshots.length > 0 ? state.snapshots[state.snapshots.length - 1]!.id : undefined,
    }
    state.snapshots.push(snapshot)
    return this.getState()
  },

  // 签署：先到者写入，后到者凭请求号看到冲突并重试，重试沿用第一次结果
  sign(input: { snapshotId: string; role: SignatureRole; reviewer: string; requestId: string }): SignResult | Promise<SignResult> {
    const { snapshotId, role, reviewer, requestId } = input
    // 幂等：同一请求号已提交，直接返回第一次结果（写入失败后按原请求号恢复）
    const existing = state.idempotency.get(requestId)
    if (existing) return { ...clone(existing), idempotent: true }
    // 并发去重：同一请求号仍在进行中，等待同一结果
    const inflight = state.inFlight.get(requestId)
    if (inflight) return inflight

    const snapshot = state.snapshots.find((s) => s.id === snapshotId)
    if (!snapshot) throw new TRPCError({ code: 'NOT_FOUND', message: `快照 ${snapshotId} 不存在。` })
    if (snapshot.status !== '有效') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `快照 ${snapshotId} 已${snapshot.status}，无法签署。失效来源：${snapshot.invalidReasons.map((r) => r.targetLabel).join('、') || '无'}`,
      })
    }
    const slot = snapshot.signatures.find((s) => s.role === role)
    if (!slot) throw new TRPCError({ code: 'BAD_REQUEST', message: `快照 ${snapshotId} 未设置 ${role} 签署位。` })

    // 异步 compare-and-set：让出事件循环，让并发请求到达；先提交者写入，后到者见冲突。
    // 写入是原子的（校验后同步置位 + 记录幂等），不会留下半份签署。
    const promise = new Promise<SignResult>((resolve, reject) => {
      setImmediate(() => {
        if (slot.status === '已签署') {
          if (state.conflicted.has(requestId)) {
            // 冲突后凭原请求号重试：沿用先到者结果
            const record: IdempotencyRecord = { snapshotId, signature: clone(slot) }
            state.idempotency.set(requestId, record)
            resolve({ ...clone(record), idempotent: true, adopted: true })
            return
          }
          // 首次见到该请求号但签署位已被先到者写入 -> 冲突
          state.conflicted.add(requestId)
          reject(
            new TRPCError({
              code: 'CONFLICT',
              message: `请求号 ${requestId} 与先到签署冲突：${slot.reviewer} 已先行签署。请凭原请求号重试，重试将沿用第一次结果。`,
            }),
          )
          return
        }
        // 先到者写入（原子）
        slot.status = '已签署'
        slot.reviewer = reviewer
        slot.requestId = requestId
        slot.signedAt = new Date().toISOString()
        const record: IdempotencyRecord = { snapshotId, signature: clone(slot) }
        state.idempotency.set(requestId, record)
        resolve({ ...clone(record), idempotent: false })
      })
    })
    state.inFlight.set(requestId, promise)
    promise.finally(() => state.inFlight.delete(requestId)).catch(() => {})
    return promise
  },

  // 清空失效项：移除失效快照（正式快照保留）
  clearInvalid() {
    state.snapshots = state.snapshots.filter((s) => s.status !== '失效')
    return this.getState()
  },

  // 生成正式版本：失效项清空 + 签署完整 + 快照有效
  generateFormal(snapshotId: string) {
    const snapshot = state.snapshots.find((s) => s.id === snapshotId)
    if (!snapshot) throw new TRPCError({ code: 'NOT_FOUND', message: `快照 ${snapshotId} 不存在。` })
    const invalid = state.snapshots.filter((s) => s.status === '失效')
    if (invalid.length > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `存在 ${invalid.length} 项失效快照未清空，无法生成正式版本。请先清空失效项。`,
      })
    }
    if (snapshot.status !== '有效') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `快照 ${snapshotId} 状态为 ${snapshot.status}，无法生成正式版本。` })
    }
    const unsigned = snapshot.signatures.filter((s) => s.status !== '已签署')
    if (unsigned.length > 0) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `签署不完整：${unsigned.map((s) => s.role).join('、')} 尚未签署。` })
    }
    snapshot.status = '正式'
    state.formalCount += 1
    snapshot.formalVersion = state.formalCount
    snapshot.formalizedAt = new Date().toISOString()
    return this.getState()
  },

  // 导出审批包：按冻结数据导出，并列出失效来源
  exportPackage(snapshotId: string) {
    const snapshot = state.snapshots.find((s) => s.id === snapshotId)
    if (!snapshot) throw new TRPCError({ code: 'NOT_FOUND', message: `快照 ${snapshotId} 不存在。` })
    return {
      packageVersion: snapshot.formalVersion ?? snapshot.version,
      snapshotId: snapshot.id,
      draftVersion: snapshot.version,
      status: snapshot.status,
      frozenAt: snapshot.frozenAt,
      formalizedAt: snapshot.formalizedAt,
      windows: clone(snapshot.frozenWindows),
      exclusiveScope: clone(snapshot.exclusiveScope),
      unresolvedComments: clone(snapshot.frozenComments),
      materials: clone(snapshot.frozenMaterials),
      signatures: clone(snapshot.signatures),
      invalidationSources: clone(snapshot.invalidReasons),
      exportedAt: new Date().toISOString(),
    }
  },

  reset() {
    state.initialized = false
    state.draftVersion = 0
    state.draftWindows = []
    state.draftComments = []
    state.draftMaterials = []
    state.snapshots = []
    state.snapshotSeq = 0
    state.idempotency.clear()
    state.inFlight.clear()
    state.conflicted.clear()
    state.formalCount = 0
    return this.getState()
  },
}
