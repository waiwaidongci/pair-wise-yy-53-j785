import type { LicenseWindow, RightsComment } from './types'

/** 审批冻结的宣传/交付物料 */
export interface ApprovalMaterial {
  id: string
  name: string
  windowIds: string[]
  version: string
  checksum: string
  updatedAt: string
}

export type SnapshotStatus = 'active' | 'invalidated' | 'superseded' | 'released'
export type SignoffState = 'pending' | 'signed' | 'voided'
export type InvalidationSource = 'window' | 'exclusivity' | 'comment' | 'material'

export interface FrozenComment {
  id: string
  channel: string
  anchor: string
  author: string
  role: string
  content: string
  resolved: boolean
}

export interface ExclusivityScopeItem {
  windowId: string
  channel: string
  territory: string
  rights: string
  exclusive: boolean
}

/** 失效来源：任一冻结要素在送审后发生变化即记录一条 */
export interface InvalidationRecord {
  id: string
  source: InvalidationSource
  refId: string
  refLabel: string
  detail: string
  at: string
  byRequestId: string
  /** 随快照一并失效的未完成签署（尚未签署的责任人） */
  voidedReviewers: string[]
}

export interface Signoff {
  reviewer: string
  state: SignoffState
  signedAt?: string
  requestId?: string
  voidedAt?: string
  voidedByInvalidationId?: string
}

export interface ApprovalSnapshot {
  id: string
  chainIndex: number
  prevId: string | null
  successorId?: string
  initiator: string
  reason: string
  createdAt: string
  /** 冻结时的全局修订号，用于乐观并发控制 */
  revision: number
  status: SnapshotStatus
  windowIds: string[]
  windows: LicenseWindow[]
  exclusivityScope: ExclusivityScopeItem[]
  openComments: FrozenComment[]
  materials: ApprovalMaterial[]
  checksum: string
  requiredReviewers: string[]
  signoffs: Signoff[]
  invalidations: InvalidationRecord[]
  supersededAt?: string
}

export interface FormalRelease {
  id: string
  version: string
  snapshotId: string
  checksum: string
  at: string
  byRequestId: string
}

export type RequestState = 'prepared' | 'committed' | 'failed'
export type RequestOutcome = 'written' | 'recovered' | 'replayed' | 'conflict'

export interface RequestRecord {
  id: string
  kind: string
  at: string
  state: RequestState
  outcome?: RequestOutcome
  fromRevision?: number
  toRevision?: number
  result?: unknown
  error?: string
}

/** 所有写操作统一的返回封装：成功 / 冲突（携带先到者结果）/ 业务错误 */
export type MutationResult<T> =
  | { ok: true; outcome: 'written' | 'recovered' | 'replayed'; requestId: string; revision: number; value?: T }
  | { ok: false; outcome: 'conflict'; requestId: string; revision: number; expectedRevision: number; winnerRequestId: string; winnerKind: string; firstResult?: unknown }
  | { ok: false; outcome: 'error'; requestId?: string; code: 'NOT_FOUND' | 'PRECONDITION' | 'INVALID'; message: string }

export interface ApprovalView {
  revision: number
  windows: LicenseWindow[]
  comments: RightsComment[]
  materials: ApprovalMaterial[]
  snapshots: ApprovalSnapshot[]
  releases: FormalRelease[]
  defaultReviewers: string[]
}
