import type {
  ApprovalMaterial,
  ApprovalSnapshot,
  ApprovalView,
  ExclusivityScopeItem,
  FormalRelease,
  FrozenComment,
  InvalidationRecord,
  InvalidationSource,
  MutationResult,
  RequestRecord,
  Signoff,
} from './approval-types'
import type { LicenseWindow, RightsComment } from './types'
import { checksum } from './checksum'

interface ApprovalState {
  revision: number
  windows: LicenseWindow[]
  comments: RightsComment[]
  materials: ApprovalMaterial[]
  snapshots: ApprovalSnapshot[]
  releases: FormalRelease[]
  defaultReviewers: string[]
  requests: Record<string, RequestRecord>
}

export interface ApprovalEngineOptions {
  windows: LicenseWindow[]
  comments: RightsComment[]
  materials: ApprovalMaterial[]
  defaultReviewers: string[]
  now?: () => string
  /** 提交故障注入：run 完成、修订号提交前模拟落库失败（用于验证原子回滚与请求号恢复） */
  crashBeforeCommit?: (input: { kind: string; requestId: string }) => boolean
}

let sequence = 0
function localId(prefix: string, now: () => string) {
  sequence += 1
  return `${prefix}${Date.now().toString(36)}-${sequence.toString(36)}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function snapshotPayload(s: Pick<ApprovalSnapshot, 'windows' | 'exclusivityScope' | 'openComments' | 'materials'>) {
  return { windows: s.windows, exclusivityScope: s.exclusivityScope, openComments: s.openComments, materials: s.materials }
}

export interface StartApprovalInput {
  requestId: string
  initiator: string
  reason: string
  windowIds: string[]
  reviewers: string[]
  expectedRevision: number
}

export interface SignoffInput {
  requestId: string
  snapshotId: string
  reviewer: string
  expectedRevision: number
}

export interface ResubmitInput {
  requestId: string
  invalidatedSnapshotId: string
  reason: string
  reviewers: string[]
  expectedRevision: number
}

export interface ReleaseInput {
  requestId: string
  snapshotId: string
  version?: string
  expectedRevision: number
}

type WindowPatchField = 'start' | 'end' | 'channel' | 'territory' | 'rights' | 'priority' | 'sublicense'

export interface WindowChangeInput {
  requestId: string
  windowId: string
  patch: Partial<Pick<LicenseWindow, 'start' | 'end' | 'priority' | 'sublicense' | 'exclusive'>> & {
    channel?: string
    territory?: string
    rights?: string
  }
  expectedRevision: number
}

export interface CommentChangeInput {
  requestId: string
  commentId: string
  expectedRevision: number
}

export interface MaterialChangeInput {
  requestId: string
  materialId: string
  patch: Partial<Pick<ApprovalMaterial, 'name' | 'version' | 'windowIds'>>
  expectedRevision: number
}

type Input =
  | ({ kind: 'startApproval' } & StartApprovalInput)
  | ({ kind: 'signoff' } & SignoffInput)
  | ({ kind: 'resubmit' } & ResubmitInput)
  | ({ kind: 'release' } & ReleaseInput)
  | ({ kind: 'windowChange' } & WindowChangeInput)
  | ({ kind: 'commentResolve' } & CommentChangeInput)
  | ({ kind: 'materialChange' } & MaterialChangeInput)

export class EngineError extends Error {
  constructor(public code: 'NOT_FOUND' | 'PRECONDITION' | 'INVALID', message: string) {
    super(message)
  }
}

export class ApprovalEngine {
  private state: ApprovalState
  private readonly now: () => string
  private readonly crashBeforeCommit?: (input: { kind: string; requestId: string }) => boolean

  constructor(options: ApprovalEngineOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.crashBeforeCommit = options.crashBeforeCommit
    this.state = {
      revision: 0,
      windows: clone(options.windows),
      comments: clone(options.comments),
      materials: clone(options.materials),
      snapshots: [],
      releases: [],
      defaultReviewers: [...options.defaultReviewers],
      requests: {},
    }
  }

  get view(): ApprovalView {
    return {
      revision: this.state.revision,
      windows: this.state.windows,
      comments: this.state.comments,
      materials: this.state.materials,
      snapshots: this.state.snapshots,
      releases: this.state.releases,
      defaultReviewers: this.state.defaultReviewers,
    }
  }

  /**
   * 统一写入入口（请求号协议 + 乐观并发）：
   * - 已提交的 requestId：重放首次结果（replayed），绝不重复生效；
   * - prepared 的 requestId（上次写入在提交前失败）：按同一请求号恢复（recovered），原子重做；
   * - expectedRevision 落后：后到者看到冲突，并拿到先到者的首次结果供其沿用重试。
   */
  execute(input: Input): MutationResult<unknown> {
    const existing = this.state.requests[input.requestId]
    if (existing?.state === 'committed') {
      return { ok: true, outcome: 'replayed', requestId: input.requestId, revision: existing.toRevision ?? this.state.revision, value: existing.result }
    }
    if (!existing) {
      this.state.requests[input.requestId] = {
        id: input.requestId,
        kind: input.kind,
        at: this.now(),
        state: 'prepared',
        fromRevision: this.state.revision,
      }
    }

    if (input.expectedRevision !== this.state.revision) {
      const winner = this.latestWinner(input.expectedRevision, input.requestId)
      return {
        ok: false,
        outcome: 'conflict',
        requestId: input.requestId,
        revision: this.state.revision,
        expectedRevision: input.expectedRevision,
        winnerRequestId: winner?.id ?? input.requestId,
        winnerKind: winner?.kind ?? input.kind,
        firstResult: winner?.result ?? null,
      }
    }

    // 检查点：run 内任何业务校验失败或注入的提交期故障，都整份回滚到写入前，
    // 不留下半份签署或仍有效的旧快照。
    const checkpoint = clone(this.state)
    try {
      const result = this.run(input)
      if (this.crashBeforeCommit?.({ kind: input.kind, requestId: input.requestId })) {
        throw new EngineError('INVALID', '模拟落库失败：写入已回滚，请用同一请求号恢复。')
      }
      // 唯一提交点：run 抛错或注入故障则不会执行到这里；
      // 检查点保证即使 run 内已做部分修改也整体撤销。
      this.state.revision += 1
      const record = this.state.requests[input.requestId]!
      record.state = 'committed'
      record.outcome = existing ? 'recovered' : 'written'
      record.toRevision = this.state.revision
      record.result = result
      return { ok: true, outcome: record.outcome, requestId: input.requestId, revision: this.state.revision, value: result }
    } catch (error) {
      const preparedRequest = this.state.requests[input.requestId]
      this.state = clone(checkpoint)
      const message = error instanceof EngineError ? error.message : '写入失败，状态已回滚。'
      // 回滚会一并撤销 prepared 登记，补登一条 prepared 记录用于原请求号恢复。
      const record: RequestRecord = preparedRequest ?? {
        id: input.requestId,
        kind: input.kind,
        at: this.now(),
        state: 'prepared',
        fromRevision: this.state.revision,
      }
      record.state = 'prepared'
      record.error = message
      this.state.requests[input.requestId] = record
      return { ok: false, outcome: 'error', requestId: input.requestId, code: error instanceof EngineError ? error.code : 'INVALID', message }
    }
  }

  private latestWinner(staleFromRevision: number, selfRequestId: string): RequestRecord | undefined {
    return Object.values(this.state.requests)
      .filter((record) => record.state === 'committed' && (record.fromRevision ?? -1) >= staleFromRevision && record.id !== selfRequestId)
      .sort((a, b) => (b.toRevision ?? 0) - (a.toRevision ?? 0))[0]
  }

  private run(input: Input): unknown {
    switch (input.kind) {
      case 'startApproval': return this.startApproval(input)
      case 'signoff': return this.sign(input)
      case 'resubmit': return this.resubmit(input)
      case 'release': return this.release(input)
      case 'windowChange': return this.applyWindowChange(input)
      case 'commentResolve': return this.resolveComment(input)
      case 'materialChange': return this.applyMaterialChange(input)
      default: throw new EngineError('INVALID', '未知操作。')
    }
  }

  // —— 发起审批：冻结窗口、独占范围、未处理意见和物料 ——
  private startApproval(input: StartApprovalInput): ApprovalSnapshot {
    const windows = input.windowIds
      .map((id) => this.state.windows.find((item) => item.id === id))
      .filter((item): item is LicenseWindow => Boolean(item))
    if (windows.length !== input.windowIds.length) throw new EngineError('NOT_FOUND', '存在已删除或不存在的窗口，无法冻结。')
    const blocked = this.state.snapshots.find((s) => s.status === 'active' && s.windowIds.some((id) => input.windowIds.includes(id)))
    if (blocked) throw new EngineError('PRECONDITION', `这些窗口已存在进行中的审批 ${blocked.id}，请先处理。`)
    const reviewers = input.reviewers.length ? input.reviewers : this.state.defaultReviewers
    if (reviewers.length < 2) throw new EngineError('PRECONDITION', '审批至少需要两位审阅者。')

    const snapshot = this.freeze({
      windowIds: input.windowIds,
      windows,
      reviewers,
      initiator: input.initiator,
      reason: input.reason,
      prevId: null,
    })
    this.state.snapshots.push(snapshot)
    return snapshot
  }

  private freeze(args: {
    windowIds: string[]
    windows: LicenseWindow[]
    reviewers: string[]
    initiator: string
    reason: string
    prevId: string | null
  }): ApprovalSnapshot {
    const idSet = new Set(args.windowIds)
    const exclusivityScope: ExclusivityScopeItem[] = args.windows.map((item) => ({
      windowId: item.id,
      channel: item.channel,
      territory: item.territory,
      rights: item.rights,
      exclusive: item.exclusive,
    }))
    const openComments = this.state.comments
      .filter((comment) => !comment.resolved && this.commentTouchesWindows(comment, idSet))
      .map<FrozenComment>((comment) => ({ ...comment }))
    const materials = this.state.materials
      .filter((material) => material.windowIds.some((id) => idSet.has(id)))
      .map((material) => ({ ...material }))
    const base = { windows: args.windows.map((item) => ({ ...item })), exclusivityScope, openComments, materials }
    return {
      id: localId('AP-', this.now),
      chainIndex: args.prevId ? (this.state.snapshots.find((s) => s.id === args.prevId)?.chainIndex ?? 0) + 1 : 1,
      prevId: args.prevId,
      initiator: args.initiator,
      reason: args.reason,
      createdAt: this.now(),
      revision: this.state.revision,
      status: 'active',
      windowIds: [...args.windowIds],
      ...base,
      checksum: checksum(snapshotPayload(base)),
      requiredReviewers: [...args.reviewers],
      signoffs: args.reviewers.map<Signoff>((reviewer) => ({ reviewer, state: 'pending' })),
      invalidations: [],
    }
  }

  // —— 签署：两人同时提交同一快照，先到者写入，后到者凭请求号看到冲突 ——
  private sign(input: SignoffInput): { snapshotId: string; reviewer: string; signedAt: string; remaining: string[] } {
    const snapshot = this.state.snapshots.find((item) => item.id === input.snapshotId)
    if (!snapshot) throw new EngineError('NOT_FOUND', '审批快照不存在。')
    if (snapshot.status !== 'active') {
      throw new EngineError('PRECONDITION', `快照 ${snapshot.id} 已${snapshot.status === 'released' ? '发布' : snapshot.status === 'superseded' ? '被后继取代' : '失效'}，不能签署。`)
    }
    const entry = snapshot.signoffs.find((item) => item.reviewer === input.reviewer)
    if (!entry) throw new EngineError('PRECONDITION', `${input.reviewer} 不在该快照的审阅名单中。`)
    if (snapshot.invalidations.length > 0) throw new EngineError('PRECONDITION', '快照含失效项，必须重新送审后才能签署。')
    if (entry.state !== 'signed') {
      entry.state = 'signed'
      entry.signedAt = this.now()
      entry.requestId = input.requestId
    }
    return { snapshotId: snapshot.id, reviewer: input.reviewer, signedAt: entry.signedAt!, remaining: this.pendingReviewers(snapshot) }
  }

  private pendingReviewers(snapshot: ApprovalSnapshot): string[] {
    return snapshot.signoffs.filter((item) => item.state === 'pending').map((item) => item.reviewer)
  }

  // —— 失效快照重新送审：旧快照清空失效项（转 superseded），重新冻结生成后继 ——
  private resubmit(input: ResubmitInput): ApprovalSnapshot {
    const previous = this.state.snapshots.find((item) => item.id === input.invalidatedSnapshotId)
    if (!previous) throw new EngineError('NOT_FOUND', '审批快照不存在。')
    if (previous.status !== 'invalidated') throw new EngineError('PRECONDITION', '只有失效快照可以重新送审。')
    const windows = previous.windowIds
      .map((id) => this.state.windows.find((item) => item.id === id))
      .filter((item): item is LicenseWindow => Boolean(item))
    if (windows.length !== previous.windowIds.length) throw new EngineError('NOT_FOUND', '原冻结窗口已不存在，无法重新送审。')
    const reviewers = input.reviewers.length ? input.reviewers : this.state.defaultReviewers
    if (reviewers.length < 2) throw new EngineError('PRECONDITION', '审批至少需要两位审阅者。')

    const successor = this.freeze({
      windowIds: previous.windowIds,
      windows,
      reviewers,
      initiator: previous.initiator,
      reason: input.reason || `重新送审（来源：${previous.invalidations.map((item) => item.refLabel).join('、')}）`,
      prevId: previous.id,
    })
    previous.status = 'superseded'
    previous.successorId = successor.id
    previous.supersededAt = this.now()
    // 旧快照的失效记录随件归档（导出仍可追溯来源）；后继以全新冻结数据开始，无失效项。
    this.state.snapshots.push(successor)
    return successor
  }

  // —— 正式发布：失效项清空且签署完整后才能生成正式版本 ——
  private release(input: ReleaseInput): FormalRelease {
    const snapshot = this.state.snapshots.find((item) => item.id === input.snapshotId)
    if (!snapshot) throw new EngineError('NOT_FOUND', '审批快照不存在。')
    if (snapshot.status !== 'active') throw new EngineError('PRECONDITION', `快照 ${snapshot.id} 状态为 ${snapshot.status}，不能发布。`)
    if (snapshot.invalidations.length > 0) throw new EngineError('PRECONDITION', '仍存在失效来源，必须重新送审并清空失效项后才能发布。')
    if (this.pendingReviewers(snapshot).length > 0) throw new EngineError('PRECONDITION', `签署不完整，尚缺：${this.pendingReviewers(snapshot).join('、')}。`)
    const activeOnSameWindows = this.state.snapshots.filter(
      (s) => s.status === 'active' && s.windowIds.some((id) => snapshot.windowIds.includes(id)) && s.id !== snapshot.id,
    )
    if (activeOnSameWindows.length > 0) throw new EngineError('PRECONDITION', `存在其他进行中的审批 ${activeOnSameWindows.map((s) => s.id).join('、')}。`)

    const release: FormalRelease = {
      id: localId('REL-', this.now),
      version: input.version ?? `V1.${this.state.releases.length + 1}.0`,
      snapshotId: snapshot.id,
      checksum: snapshot.checksum,
      at: this.now(),
      byRequestId: input.requestId,
    }
    snapshot.status = 'released'
    this.state.releases.push(release)
    return release
  }

  // —— 窗口变化：仅失效受影响的快照与其未完成签署 ——
  private applyWindowChange(input: WindowChangeInput): { invalidatedSnapshotIds: string[] } {
    const index = this.state.windows.findIndex((item) => item.id === input.windowId)
    if (index < 0) throw new EngineError('NOT_FOUND', '窗口不存在。')
    const before = this.state.windows[index]!
    const next = { ...before, ...input.patch, status: '草案' as const } as LicenseWindow
    if (new Date(next.end) < new Date(next.start)) throw new EngineError('INVALID', '窗口结束日期不能早于开始日期。')
    this.state.windows[index] = next

    const affected: { source: InvalidationSource; refId: string; refLabel: string; detail: string }[] = []
    if (input.patch.exclusive !== undefined && input.patch.exclusive !== before.exclusive) {
      affected.push({
        source: 'exclusivity',
        refId: before.id,
        refLabel: `${before.channel} 独占范围`,
        detail: `独占标记由「${before.exclusive ? '独占' : '非独占'}」变为「${next.exclusive ? '独占' : '非独占'}」。`,
      })
    }
    const labels: Record<WindowPatchField, string> = {
      start: '开窗日期', end: '收窗日期', channel: '渠道', territory: '地区',
      rights: '权利类型', priority: '优先级', sublicense: '次级授权',
    }
    for (const key of Object.keys(labels) as WindowPatchField[]) {
      const candidate = input.patch[key]
      if (candidate !== undefined && candidate !== before[key]) {
        affected.push({
          source: 'window',
          refId: before.id,
          refLabel: `${before.channel} 授权窗口 ${before.id}`,
          detail: `${labels[key]}发生变化（${String(before[key])} → ${String(next[key])}）。`,
        })
      }
    }

    return { invalidatedSnapshotIds: this.propagate(input.requestId, affected) }
  }

  private resolveComment(input: CommentChangeInput): { invalidatedSnapshotIds: string[] } {
    const comment = this.state.comments.find((item) => item.id === input.commentId)
    if (!comment) throw new EngineError('NOT_FOUND', '意见不存在。')
    if (comment.resolved) return { invalidatedSnapshotIds: [] }
    this.state.comments = this.state.comments.map((item) => item.id === input.commentId ? { ...item, resolved: true } : item)

    // 仅命中冻结了该「未处理意见」的快照；送审后新增的意见不在旧冻结中，不影响旧快照。
    const scope = new Set(
      this.state.snapshots
        .filter((s) => s.status === 'active' && s.openComments.some((frozen) => frozen.id === input.commentId && !frozen.resolved))
        .map((s) => s.id),
    )
    return {
      invalidatedSnapshotIds: this.propagate(
        input.requestId,
        [{ source: 'comment', refId: comment.id, refLabel: `${comment.role}意见 ${comment.id}`, detail: `未处理意见已处理：${comment.content}` }],
        scope,
      ),
    }
  }

  private applyMaterialChange(input: MaterialChangeInput): { invalidatedSnapshotIds: string[] } {
    const index = this.state.materials.findIndex((item) => item.id === input.materialId)
    if (index < 0) throw new EngineError('NOT_FOUND', '物料不存在。')
    const before = this.state.materials[index]!
    const next: ApprovalMaterial = {
      ...before,
      ...input.patch,
      checksum: checksum({ name: input.patch.name ?? before.name, version: input.patch.version ?? before.version, windowIds: input.patch.windowIds ?? before.windowIds }),
      updatedAt: this.now(),
    }
    this.state.materials[index] = next
    return {
      invalidatedSnapshotIds: this.propagate(input.requestId, [{
        source: 'material',
        refId: before.id,
        refLabel: `物料 ${before.name}`,
        detail: input.patch.version !== undefined && input.patch.version !== before.version
          ? `物料版本由 ${before.version} 变更为 ${next.version}。`
          : '物料内容或绑定窗口发生变化。',
      }]),
    }
  }

  /**
   * 变化传播：命中受影响 active 快照 → 追加失效来源、作废未完成签署、置为 invalidated。
   * 原快照冻结原件保留可追溯；其他快照与已完成签署不受影响。
   */
  private propagate(
    requestId: string,
    affected: { source: InvalidationSource; refId: string; refLabel: string; detail: string }[],
    scope?: Set<string>,
  ): string[] {
    if (affected.length === 0) return []
    const hitIds: string[] = []
    for (const snapshot of this.state.snapshots) {
      if (snapshot.status !== 'active') continue
      const touches = scope
        ? scope.has(snapshot.id)
        : affected.some((item) => this.snapshotTouches(snapshot, item.source, item.refId))
      if (!touches) continue

      const pending = this.pendingReviewers(snapshot)
      const records: InvalidationRecord[] = affected.map((item, order) => ({
        id: localId('IV-', this.now),
        source: item.source,
        refId: item.refId,
        refLabel: item.refLabel,
        detail: item.detail,
        at: this.now(),
        byRequestId: requestId,
        // 被作废的未完成签署统一挂在首个失效来源上，避免重复列名
        voidedReviewers: order === 0 ? pending : [],
      }))
      snapshot.invalidations.push(...records)
      snapshot.signoffs = snapshot.signoffs.map((entry) =>
        entry.state === 'signed'
          ? entry
          : { ...entry, state: 'voided', voidedAt: this.now(), voidedByInvalidationId: records[0]!.id },
      )
      snapshot.status = 'invalidated'
      hitIds.push(snapshot.id)
    }
    return hitIds
  }

  private snapshotTouches(snapshot: ApprovalSnapshot, source: InvalidationSource, refId: string): boolean {
    if (source === 'window' || source === 'exclusivity') return snapshot.windowIds.includes(refId)
    if (source === 'comment') return snapshot.openComments.some((comment) => comment.id === refId && !comment.resolved)
    if (source === 'material') {
      const current = this.state.materials.find((item) => item.id === refId)
      const frozen = snapshot.materials.find((item) => item.id === refId)
      return Boolean(frozen && current && frozen.checksum !== current.checksum)
    }
    return false
  }

  private commentTouchesWindows(comment: RightsComment, windowIds: Set<string>): boolean {
    const anchorMatch = comment.anchor.match(/RW-\d+/)
    if (anchorMatch && windowIds.has(anchorMatch[0])) return true
    return this.state.windows.some((item) => windowIds.has(item.id) && item.channel === comment.channel)
  }

  // —— 审批包：始终按冻结数据导出，并列出失效来源 ——
  exportPackage(snapshotId: string): Record<string, unknown> {
    const snapshot = this.state.snapshots.find((item) => item.id === snapshotId)
    if (!snapshot) throw new EngineError('NOT_FOUND', '审批快照不存在。')
    const release = this.state.releases.find((item) => item.snapshotId === snapshot.id)
    return {
      packageType: '发行权审批包',
      exportedAt: this.now(),
      snapshot: {
        id: snapshot.id,
        chainIndex: snapshot.chainIndex,
        prevId: snapshot.prevId,
        successorId: snapshot.successorId ?? null,
        status: snapshot.status,
        initiator: snapshot.initiator,
        reason: snapshot.reason,
        createdAt: snapshot.createdAt,
        frozenRevision: snapshot.revision,
        checksum: snapshot.checksum,
      },
      // 以下全部取自冻结原件，而非当前工作区数据
      frozenData: {
        windows: snapshot.windows,
        exclusivityScope: snapshot.exclusivityScope,
        openComments: snapshot.openComments,
        materials: snapshot.materials,
      },
      review: {
        requiredReviewers: snapshot.requiredReviewers,
        signoffs: snapshot.signoffs,
        complete: this.pendingReviewers(snapshot).length === 0 && snapshot.invalidations.length === 0,
      },
      invalidationSources: snapshot.invalidations.map((item) => ({
        id: item.id,
        source: item.source,
        refId: item.refId,
        refLabel: item.refLabel,
        detail: item.detail,
        at: item.at,
        byRequestId: item.byRequestId,
        voidedReviewers: item.voidedReviewers,
      })),
      formalVersion: release
        ? { version: release.version, releaseId: release.id, releasedAt: release.at, byRequestId: release.byRequestId }
        : null,
    }
  }
}

export function isReleasable(snapshot: ApprovalSnapshot): boolean {
  return snapshot.status === 'active' && snapshot.invalidations.length === 0 && snapshot.signoffs.every((entry) => entry.state === 'signed')
}
