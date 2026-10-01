import type { LicenseWindow } from './types'

export interface ConflictIssue {
  id: string
  type: '时间重叠' | '地区交叉' | '窗口倒挂' | '独占冲突'
  severity: '高' | '中'
  windowIds: string[]
  title: string
  explanation: string
}

const order = ['院线', '电视', '流媒体', '航空', '非院线']

export function findConflicts(windows: LicenseWindow[]): ConflictIssue[] {
  const issues: ConflictIssue[] = []
  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      const a = windows[i]!
      const b = windows[j]!
      if (a.workId !== b.workId || a.territory !== b.territory) continue
      const overlap = new Date(a.start) <= new Date(b.end) && new Date(b.start) <= new Date(a.end)
      if (overlap && a.exclusive && b.exclusive) issues.push({ id: `${a.id}-${b.id}-EX`, type: '独占冲突', severity: '高', windowIds: [a.id, b.id], title: `${a.channel} 与 ${b.channel} 独占期重叠`, explanation: `同一作品在 ${a.territory} 的独占窗口重叠 ${Math.max(1, Math.ceil((Math.min(new Date(a.end).getTime(), new Date(b.end).getTime()) - Math.max(new Date(a.start).getTime(), new Date(b.start).getTime())) / 86400000))} 天，必须调整一方窗口或解除独占。` })
      else if (overlap && (a.exclusive || b.exclusive)) issues.push({ id: `${a.id}-${b.id}-NEX`, type: '独占冲突', severity: '中', windowIds: [a.id, b.id], title: `${a.exclusive ? a.channel : b.channel} 独占范围内存在非独占授权`, explanation: '独占条款优先于普通授权，需确认合同是否设置“同渠道、同语言、同区域”的例外。' })
      const earlier = order.indexOf(a.rights) < order.indexOf(b.rights) ? a : b
      const later = earlier === a ? b : a
      if (new Date(later.start) < new Date(earlier.end) && !overlap) issues.push({ id: `${a.id}-${b.id}-ORDER`, type: '窗口倒挂', severity: '高', windowIds: [a.id, b.id], title: `${later.channel} 开窗早于前置窗口结束`, explanation: '不同授权窗口出现无重叠但倒挂的情况，请复核排期并重新计算窗口优先级。' })
    }
  }
  return issues
}

export function shiftWindow(win: LicenseWindow, days: number): LicenseWindow {
  const shift = (date: string) => { const value = new Date(date); value.setDate(value.getDate() + days); return value.toISOString().slice(0, 10) }
  return { ...win, start: shift(win.start), end: shift(win.end), status: '草案' }
}
