export type RightsType = '院线' | '电视' | '流媒体' | '航空' | '非院线'
export type Territory = '中国大陆' | '中国香港' | '中国台湾' | '新加坡' | '马来西亚' | '东南亚区域' | '北美'

export interface LicenseWindow {
  id: string
  workId: string
  work: string
  channel: string
  rights: RightsType
  territory: Territory
  start: string
  end: string
  exclusive: boolean
  sublicense: boolean
  priority: number
  status: '草案' | '冲突' | '已确认'
}

export interface RightsComment {
  id: string
  channel: string
  anchor: string
  author: string
  role: string
  content: string
  resolved: boolean
}

export interface DraftVersion {
  id: string
  author: string
  time: string
  summary: string
  changes: string[]
}

// 审批快照与签署（版本链）
export type SnapshotStatus = '有效' | '失效' | '正式'
export type SignatureStatus = '待签署' | '已签署' | '已失效'
export type SignatureRole = '法务' | '发行'

export interface FrozenMaterial {
  id: string
  name: string
  type: '宣传物料' | '地区物料包' | '授权证明'
  region: string
  note?: string
}

export type InvalidationType = '窗口变更' | '独占范围变更' | '意见处理' | '物料变更' | '窗口新增' | '窗口删除'

export interface InvalidationReason {
  atVersion: number
  type: InvalidationType
  targetId: string
  targetLabel: string
  field?: string
  from?: string
  to?: string
}

export interface Signature {
  id: string
  role: SignatureRole
  reviewer: string
  status: SignatureStatus
  requestId?: string
  signedAt?: string
  adopted?: boolean
}

export interface Snapshot {
  id: string
  version: number
  status: SnapshotStatus
  frozenAt: string
  frozenWindows: LicenseWindow[]
  frozenComments: RightsComment[]
  frozenMaterials: FrozenMaterial[]
  exclusiveScope: { windowId: string; channel: string; territory: string; exclusive: boolean }[]
  requiredRoles: SignatureRole[]
  signatures: Signature[]
  invalidReasons: InvalidationReason[]
  formalVersion?: number
  formalizedAt?: string
  parentSnapshotId?: string
}
