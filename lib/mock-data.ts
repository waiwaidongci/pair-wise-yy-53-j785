import type { DraftVersion, FrozenMaterial, LicenseWindow, RightsComment } from './types'

export const initialWindows: LicenseWindow[] = [
  { id: 'RW-101', workId: 'W-001', work: '《远山回声》', channel: '星海影院', rights: '院线', territory: '中国大陆', start: '2026-10-18', end: '2026-12-05', exclusive: true, sublicense: false, priority: 1, status: '冲突' },
  { id: 'RW-102', workId: 'W-001', work: '《远山回声》', channel: '云帆视频', rights: '流媒体', territory: '中国大陆', start: '2026-11-20', end: '2027-11-19', exclusive: true, sublicense: false, priority: 2, status: '冲突' },
  { id: 'RW-103', workId: 'W-001', work: '《远山回声》', channel: '南华卫视', rights: '电视', territory: '中国大陆', start: '2027-01-08', end: '2027-03-31', exclusive: false, sublicense: true, priority: 4, status: '草案' },
  { id: 'RW-104', workId: 'W-002', work: '《深港口岸》', channel: '云帆视频', rights: '流媒体', territory: '新加坡', start: '2026-12-01', end: '2027-05-31', exclusive: true, sublicense: false, priority: 1, status: '已确认' },
  { id: 'RW-105', workId: 'W-002', work: '《深港口岸》', channel: '海岛航空', rights: '航空', territory: '东南亚区域', start: '2027-01-15', end: '2027-07-14', exclusive: false, sublicense: true, priority: 3, status: '草案' },
]

export const initialComments: RightsComment[] = [
  { id: 'CM-31', channel: '星海影院', anchor: 'RW-101 · 院线独占尾部', author: '黎清', role: '法务', content: '流媒体开窗早于院线独占结束 15 天，违反窗口倒挂约束。请至少顺延至 2026-12-06。', resolved: false },
  { id: 'CM-32', channel: '云帆视频', anchor: 'RW-102 · 地区范围', author: '章宁', role: '发行', content: '中国大陆独占与港澳台授权不冲突，但宣传物料的地区标识必须拆分为两个物料包。', resolved: false },
  { id: 'CM-33', channel: '南华卫视', anchor: 'RW-103 · 次级授权', author: '黎清', role: '法务', content: '允许转授权，但须禁止向短视频平台分发超过 3 分钟的连续片段。', resolved: true },
]

export const versions: DraftVersion[] = [
  { id: 'v18', author: '章宁', time: '今天 16:35', summary: '调整《远山回声》流媒体窗口并增加港台地区', changes: ['RW-102 开窗日期由 11-15 调整为 11-20', '新增流媒体中国香港、中国台湾窗口', '独占范围拆分与宣传物料条件'] },
  { id: 'v17', author: '黎清', time: '今天 14:08', summary: '补充院线优先权和次级授权限制', changes: ['院线窗口优先级提升为 1', '电视窗口禁止提前点映', '转授权增加地区与时长限制'] },
]

export const initialMaterials: FrozenMaterial[] = [
  { id: 'MT-01', name: '《远山回声》主海报', type: '宣传物料', region: '中国大陆', note: '院线与流媒体通用' },
  { id: 'MT-02', name: '《远山回声》港澳台物料包', type: '地区物料包', region: '中国香港/中国台湾', note: '按意见拆分为两个物料包' },
  { id: 'MT-03', name: '《深港口岸》东南亚授权证明', type: '授权证明', region: '东南亚区域' },
]

export const materialCatalog: Omit<FrozenMaterial, 'id'>[] = [
  { name: '《远山回声》短视频片段包', type: '宣传物料', region: '中国大陆', note: '单片不超过 3 分钟' },
  { name: '《深港口岸》机舱版剪辑', type: '地区物料包', region: '航空', note: '航空渠道专用' },
  { name: '《远山回声》港台拆分海报（香港）', type: '地区物料包', region: '中国香港' },
  { name: '《远山回声》港台拆分海报（台湾）', type: '地区物料包', region: '中国台湾' },
]
