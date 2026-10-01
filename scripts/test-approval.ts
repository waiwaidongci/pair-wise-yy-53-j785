/**
 * 版本链语义端到端校验（不经过 HTTP，直接跑引擎，断言确定性）。
 * 运行：npx tsx scripts/test-approval.ts
 */
import assert from 'node:assert/strict'
import { ApprovalEngine } from '../lib/approval-engine'
import { defaultReviewers, initialComments, initialMaterials, initialWindows } from '../lib/mock-data'

let clock = 0
const now = () => `2026-10-01T${String(8 + Math.floor(clock / 60)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}:00.000Z`
function makeEngine(crash?: (input: { kind: string; requestId: string }) => boolean) {
  return new ApprovalEngine({ windows: initialWindows, comments: initialComments, materials: initialMaterials, defaultReviewers, now: () => { clock += 1; return now() }, crashBeforeCommit: crash })
}
let pass = 0
function ok(name: string, fn: () => void) {
  fn()
  pass += 1
  console.log(`  ✓ ${name}`)
}

console.log('1) 发起审批冻结窗口/独占/未处理意见/物料')
{
  const engine = makeEngine()
  const started = engine.execute({ kind: 'startApproval', requestId: 'R1', initiator: '章宁', reason: '首版送审', windowIds: ['RW-101', 'RW-102'], reviewers: defaultReviewers, expectedRevision: 0 })
  assert.equal(started.ok, true)
  if (!started.ok) throw new Error('unreachable')
  const snap = started.value as never as import('../lib/approval-types').ApprovalSnapshot
  assert.equal(snap.status, 'active')
  assert.equal(snap.windows.length, 2)
  assert.equal(snap.openComments.length, 2, 'CM-31 锚 RW-101，CM-32 锚 RW-102 均应冻结；CM-33 已处理不应冻结')
  assert.deepEqual(snap.openComments.map((c) => c.id).sort(), ['CM-31', 'CM-32'])
  assert.ok(snap.materials.some((m) => m.id === 'MT-01') && snap.materials.some((m) => m.id === 'MT-02'))
  assert.equal(snap.exclusivityScope.every((e) => e.exclusive === true), true)
  assert.deepEqual(snap.signoffs.map((s) => s.state), ['pending', 'pending'])
  ok('冻结数据与审阅名单正确', () => {})
  ok('校验和已生成', () => assert.match(snap.checksum, /^fnv1a-/))
}

console.log('2) 后续变化仅失效受影响快照与未完成签署，已完成签署和其他快照保留')
{
  const engine = makeEngine()
  const r1 = engine.execute({ kind: 'startApproval', requestId: 'R1', initiator: '章宁', reason: 'W-001 送审', windowIds: ['RW-101', 'RW-102'], reviewers: defaultReviewers, expectedRevision: 0 })
  const snapA = (r1 as { value: import('../lib/approval-types').ApprovalSnapshot }).value
  const r2 = engine.execute({ kind: 'startApproval', requestId: 'R2', initiator: '章宁', reason: 'W-002 送审', windowIds: ['RW-104'], reviewers: defaultReviewers, expectedRevision: 1 })
  const snapB = (r2 as { value: import('../lib/approval-types').ApprovalSnapshot }).value

  // snapA：法务先签
  const s1 = engine.execute({ kind: 'signoff', requestId: 'R3', snapshotId: snapA.id, reviewer: defaultReviewers[0]!, expectedRevision: 2 })
  assert.equal(s1.ok, true)
  // snapB：两人都签完
  engine.execute({ kind: 'signoff', requestId: 'R4', snapshotId: snapB.id, reviewer: defaultReviewers[0]!, expectedRevision: 3 })
  engine.execute({ kind: 'signoff', requestId: 'R5', snapshotId: snapB.id, reviewer: defaultReviewers[1]!, expectedRevision: 4 })

  // 改 RW-102 独占范围
  const change = engine.execute({ kind: 'windowChange', requestId: 'R6', windowId: 'RW-102', patch: { exclusive: false }, expectedRevision: 5 })
  assert.equal(change.ok, true)
  const after = engine.view.snapshots
  const a = after.find((s) => s.id === snapA.id)!
  const b = after.find((s) => s.id === snapB.id)!
  ok('受影响快照失效', () => assert.equal(a.status, 'invalidated'))
  ok('失效来源记录为独占范围变化', () => assert.equal(a.invalidations[0]!.source, 'exclusivity'))
  ok('已完成签署保留', () => assert.equal(a.signoffs.find((s) => s.reviewer === defaultReviewers[0])!.state, 'signed'))
  ok('未完成签署作废并登记在失效来源上', () => {
    assert.equal(a.signoffs.find((s) => s.reviewer === defaultReviewers[1])!.state, 'voided')
    assert.deepEqual(a.invalidations[0]!.voidedReviewers, [defaultReviewers[1]])
  })
  ok('无关快照继续有效且签署完整', () => {
    assert.equal(b.status, 'active')
    assert.ok(b.signoffs.every((s) => s.state === 'signed'))
  })
  ok('冻结原件未被工作区变化改写', () => {
    assert.equal(a.windows.find((w) => w.id === 'RW-102')!.exclusive, true)
    assert.equal(engine.view.windows.find((w) => w.id === 'RW-102')!.exclusive, false)
  })
  ok('失效快照不能直接签署', () => {
    const blocked = engine.execute({ kind: 'signoff', requestId: 'R7', snapshotId: a.id, reviewer: defaultReviewers[1]!, expectedRevision: 6 })
    assert.equal(blocked.ok, false)
    assert.equal((blocked as { outcome: string }).outcome, 'error')
  })
}

console.log('3) 两人同时提交同一快照：先到者写入，后到者冲突并沿用首次结果')
{
  const engine = makeEngine()
  engine.execute({ kind: 'startApproval', requestId: 'R1', initiator: '章宁', reason: '送审', windowIds: ['RW-101'], reviewers: defaultReviewers, expectedRevision: 0 })
  const snap = engine.view.snapshots[0]!
  // 两个请求基于同一修订号 r1（revision=1）
  const first = engine.execute({ kind: 'signoff', requestId: 'C1', snapshotId: snap.id, reviewer: defaultReviewers[0]!, expectedRevision: 1 })
  const second = engine.execute({ kind: 'signoff', requestId: 'C2', snapshotId: snap.id, reviewer: defaultReviewers[1]!, expectedRevision: 1 })
  ok('先到者写入', () => {
    assert.equal(first.ok, true)
    assert.equal((first as { outcome: string }).outcome, 'written')
  })
  ok('后到者拿到冲突与先到者请求号/首次结果', () => {
    assert.equal(second.ok, false)
    if (second.ok) throw new Error('unreachable')
    assert.equal(second.outcome, 'conflict')
    assert.equal(second.winnerRequestId, 'C1')
    assert.equal(second.revision, 2)
    assert.deepEqual((second.firstResult as { reviewer: string }).reviewer, defaultReviewers[0])
  })
  // 后到者沿用第一次结果：用先到者的请求号重放
  const replayWinner = engine.execute({ kind: 'signoff', requestId: 'C1', snapshotId: snap.id, reviewer: defaultReviewers[0]!, expectedRevision: 99 })
  ok('先到请求号重放返回首次结果，不重复生效', () => {
    assert.equal(replayWinner.ok, true)
    assert.equal((replayWinner as { outcome: string }).outcome, 'replayed')
    assert.equal(engine.view.snapshots[0]!.signoffs.filter((s) => s.state === 'signed').length, 1)
  })
  // 后到者刷新修订号后提交自己的签署（新请求，基于 revision=2）
  const retry = engine.execute({ kind: 'signoff', requestId: 'C2b', snapshotId: snap.id, reviewer: defaultReviewers[1]!, expectedRevision: 2 })
  ok('后到者刷新修订号后成功', () => assert.equal(retry.ok, true))
}

console.log('4) 提交期写入失败：回滚不留半成品，原请求号恢复')
{
  let crashOn = 'F1'
  const engine = makeEngine(({ requestId }) => { if (requestId === crashOn) { crashOn = ''; return true }; return false })
  const failed = engine.execute({ kind: 'startApproval', requestId: 'F1', initiator: '章宁', reason: '送审', windowIds: ['RW-101'], reviewers: defaultReviewers, expectedRevision: 0 })
  ok('故障返回 error 且修订号不动', () => {
    assert.equal(failed.ok, false)
    assert.equal(engine.view.revision, 0)
    assert.equal(engine.view.snapshots.length, 0)
  })
  const recovered = engine.execute({ kind: 'startApproval', requestId: 'F1', initiator: '章宁', reason: '送审', windowIds: ['RW-101'], reviewers: defaultReviewers, expectedRevision: 0 })
  ok('同一请求号恢复成功并标记 recovered', () => {
    assert.equal(recovered.ok, true)
    assert.equal((recovered as { outcome: string }).outcome, 'recovered')
    assert.equal(engine.view.revision, 1)
    assert.equal(engine.view.snapshots.length, 1)
  })
  const again = engine.execute({ kind: 'startApproval', requestId: 'F1', initiator: '章宁', reason: '送审', windowIds: ['RW-101'], reviewers: defaultReviewers, expectedRevision: 1 })
  ok('再次重放不产生第二份快照', () => {
    assert.equal((again as { outcome: string }).outcome, 'replayed')
    assert.equal(engine.view.snapshots.length, 1)
  })

  // 签署写到一半崩溃：不得留下签署
  let crashSign = 'F2'
  const e2 = makeEngine(({ requestId }) => { if (requestId === crashSign) { crashSign = ''; return true }; return false })
  e2.execute({ kind: 'startApproval', requestId: 'F0', initiator: '章宁', reason: '送审', windowIds: ['RW-101'], reviewers: defaultReviewers, expectedRevision: 0 })
  const snapId = e2.view.snapshots[0]!.id
  const signFail = e2.execute({ kind: 'signoff', requestId: 'F2', snapshotId: snapId, reviewer: defaultReviewers[0]!, expectedRevision: 1 })
  ok('签署故障后无半份签署', () => {
    assert.equal(signFail.ok, false)
    assert.equal(e2.view.snapshots[0]!.signoffs.every((s) => s.state === 'pending'), true)
    assert.equal(e2.view.revision, 1)
  })
  const signRecover = e2.execute({ kind: 'signoff', requestId: 'F2', snapshotId: snapId, reviewer: defaultReviewers[0]!, expectedRevision: 1 })
  ok('签署按原请求号恢复', () => {
    assert.equal(signRecover.ok, true)
    assert.equal(e2.view.snapshots[0]!.signoffs[0]!.state, 'signed')
  })
}

console.log('5) 失效 → 重新送审：旧件 superseded 并清空失效项，链指针正确，再签完整才发布')
{
  const engine = makeEngine()
  engine.execute({ kind: 'startApproval', requestId: 'R1', initiator: '章宁', reason: '送审', windowIds: ['RW-101', 'RW-102'], reviewers: defaultReviewers, expectedRevision: 0 })
  const firstId = engine.view.snapshots[0]!.id
  engine.execute({ kind: 'signoff', requestId: 'R2', snapshotId: firstId, reviewer: defaultReviewers[0]!, expectedRevision: 1 })
  engine.execute({ kind: 'windowChange', requestId: 'R3', windowId: 'RW-102', patch: { start: '2026-12-01' }, expectedRevision: 2 })

  // 失效时尝试发布：拒绝
  const blockedRelease = engine.execute({ kind: 'release', requestId: 'R4', snapshotId: firstId, expectedRevision: 3 })
  ok('失效快照禁止发布', () => assert.equal(blockedRelease.ok, false))

  const resub = engine.execute({ kind: 'resubmit', requestId: 'R5', invalidatedSnapshotId: firstId, reason: '', reviewers: defaultReviewers, expectedRevision: 3 })
  const next = (resub as { value: import('../lib/approval-types').ApprovalSnapshot }).value
  const old = engine.view.snapshots.find((s) => s.id === firstId)!
  ok('旧快照转 superseded 且指向后继', () => {
    assert.equal(old.status, 'superseded')
    assert.equal(old.successorId, next.id)
  })
  ok('后继清空失效项、链接 prevId、chainIndex 递增', () => {
    assert.equal(next.prevId, firstId)
    assert.equal(next.chainIndex, 2)
    assert.equal(next.invalidations.length, 0)
    assert.deepEqual(next.signoffs.map((s) => s.state), ['pending', 'pending'])
  })
  ok('后继冻结了已变化后的窗口', () => assert.equal(next.windows.find((w) => w.id === 'RW-102')!.start, '2026-12-01'))
  ok('旧快照失效来源仍可追溯', () => assert.equal(old.invalidations[0]!.source, 'window'))

  // 只签一人：仍不能发布
  engine.execute({ kind: 'signoff', requestId: 'R6', snapshotId: next.id, reviewer: defaultReviewers[0]!, expectedRevision: 4 })
  const half = engine.execute({ kind: 'release', requestId: 'R7', snapshotId: next.id, expectedRevision: 5 })
  ok('签署不完整禁止发布', () => assert.equal(half.ok, false))
  engine.execute({ kind: 'signoff', requestId: 'R8', snapshotId: next.id, reviewer: defaultReviewers[1]!, expectedRevision: 5 })
  const released = engine.execute({ kind: 'release', requestId: 'R9', snapshotId: next.id, version: 'V2.0.0', expectedRevision: 6 })
  ok('失效项清空且签署完整后生成正式版本', () => {
    assert.equal(released.ok, true)
    assert.equal(engine.view.snapshots.find((s) => s.id === next.id)!.status, 'released')
    assert.equal(engine.view.releases[0]!.version, 'V2.0.0')
  })
}

console.log('6) 审批包按冻结数据导出并列出失效来源')
{
  const engine = makeEngine()
  engine.execute({ kind: 'startApproval', requestId: 'R1', initiator: '章宁', reason: '送审', windowIds: ['RW-102'], reviewers: defaultReviewers, expectedRevision: 0 })
  const id = engine.view.snapshots[0]!.id
  engine.execute({ kind: 'windowChange', requestId: 'R2', windowId: 'RW-102', patch: { exclusive: false }, expectedRevision: 1 })
  const pkg = engine.exportPackage(id) as any
  ok('导出使用冻结独占值', () => assert.equal(pkg.frozenData.windows[0].exclusive, true))
  ok('导出列出失效来源与作废审阅者', () => {
    assert.equal(pkg.invalidationSources.length, 1)
    assert.equal(pkg.invalidationSources[0].source, 'exclusivity')
    assert.deepEqual(pkg.invalidationSources[0].voidedReviewers, defaultReviewers)
  })
  ok('导出包含链信息与校验和', () => {
    assert.equal(pkg.snapshot.status, 'invalidated')
    assert.match(pkg.snapshot.checksum, /^fnv1a-/)
  })
}

console.log('7) 意见处理与物料变更的影响隔离')
{
  const engine = makeEngine()
  engine.execute({ kind: 'startApproval', requestId: 'R1', initiator: '章宁', reason: 'W-001', windowIds: ['RW-101', 'RW-102'], reviewers: defaultReviewers, expectedRevision: 0 })
  engine.execute({ kind: 'startApproval', requestId: 'R2', initiator: '章宁', reason: 'W-002', windowIds: ['RW-104'], reviewers: defaultReviewers, expectedRevision: 1 })
  const a = engine.view.snapshots[0]!
  const b = engine.view.snapshots[1]!
  // 处理 CM-31（只锚 RW-101）
  engine.execute({ kind: 'commentResolve', requestId: 'R3', commentId: 'CM-31', expectedRevision: 2 })
  ok('处理冻结的未处理意见使 A 失效，B 不受影响', () => {
    assert.equal(engine.view.snapshots.find((s) => s.id === a.id)!.status, 'invalidated')
    assert.equal(engine.view.snapshots.find((s) => s.id === b.id)!.status, 'active')
  })
  // 物料 MT-04 属于 B
  engine.execute({ kind: 'materialChange', requestId: 'R4', materialId: 'MT-04', patch: { version: 'm-2027.01' }, expectedRevision: 3 })
  ok('物料变更仅失效引用该物料的快照', () => {
    assert.equal(engine.view.snapshots.find((s) => s.id === b.id)!.status, 'invalidated')
    assert.equal(engine.view.snapshots.find((s) => s.id === b.id)!.invalidations[0]!.source, 'material')
  })
}

console.log(`\n全部通过：${pass} 组断言`)
