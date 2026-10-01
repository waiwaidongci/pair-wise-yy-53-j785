# 影视内容发行权窗口与独占冲突审阅平台

源提示词编号：10。维护作品、权利类型、地区、语言、窗口、独占和次级授权，联动时间轴与地区矩阵，检测重叠、交叉、倒挂和独占冲突，支持批量调窗、版本差异、评论锚点、审批和追溯导出。

## 技术栈

Next.js App Router、Chakra UI、Zustand、TanStack Query、tRPC、Zod、TypeScript。

## 运行

```bash
npm install
npm run dev
```

开发地址：http://localhost:62053

```bash
npm run build
```

## 审批快照版本链

`/approvals` 页面与 `lib/approval-engine.ts` 实现了「窗口 / 独占范围 / 条款意见 / 物料 → 审批快照 → 签署 → 正式版本」的版本链：

- **发起即冻结**：快照深拷贝冻结窗口、独占范围、当前未处理意见（按锚点/渠道命中）和物料，并计算 FNV-1a 校验和；冻结数据不受工作区后续修改影响。
- **变化传播**：窗口改期、独占范围变更、冻结意见被处理、物料升版，只把**受影响的 active 快照**置为 `invalidated` 并追加失效来源（`window/exclusivity/comment/material`），同时仅作废其**未完成签署**；原冻结原件、其他快照、已完成签署继续有效。
- **重新送审**：失效快照执行 resubmit 后转为 `superseded` 并指向后继（`prevId/successorId/chainIndex` 成链），后继重新冻结、失效项清空、签署名单重置。
- **发布闸门**：快照仍 active、失效来源为空、全部审阅者签署完成，才能生成正式版本（`FormalRelease`）。
- **并发协议**：所有写入带 `requestId` + `expectedRevision`（全局修订号）。两人同批提交时先到者 `written`，后到者收到 `conflict` 并拿到先到者请求号与首次结果；用先到者请求号重放得到同一结果（`replayed`），或刷新修订号后以新请求号重试。
- **失败原子性**：写入在唯一提交点落库，业务校验失败或提交期故障都会整体回滚到检查点（修订号不前进、无半份签署、无仍有效的旧快照）；保留 `prepared` 请求记录，客户端用**原请求号**恢复，成功标记为 `recovered`。
- **审批包导出**：`exportPackage` 始终导出冻结原件，并列出全部失效来源、被作废的审阅者、链指针与校验和。

内存版引擎用单例（`server/approval-store.ts`）模拟服务端串行写入；接入数据库时替换为事务 + 幂等请求表即可，协议不变。

```bash
npm run test:approvals   # 版本链 7 组场景 / 30 条断言
```
