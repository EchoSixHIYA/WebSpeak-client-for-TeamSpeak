# 成员在线状态未知

- 日期：2026-10-06
- 对象：WebSpeak TeamSpeak 成员目录

## 根因与修改

- TeamSpeak SDK 的 `clientEnter` 事件仅包含成员基础资料，不携带 `away`；成员进入后若没有 `clientUpdated`，网页会一直显示“状态未知”。
- 新成员进入后 debounce 300 ms 查询并合并一次权威 `clientlist` 快照以补齐状态；仅更新当前仍在目录中的成员，避免成员离开后被迟到的查询结果复活。目录首个快照尚未就绪时会排队合并。

## 验证

- `npm test`：40 项通过。
- `npm run build`：通过。
- `cd web && npm run build`：Vue 类型检查通过，Vite 192 modules 构建成功。
- 目前仅提交到当前 GitHub 功能分支，尚未部署生产；线上行为仍需在真实成员会话中验收。
