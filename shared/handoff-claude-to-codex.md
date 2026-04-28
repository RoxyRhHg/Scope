# Claude → Codex 任务交接规范

当 Claude 完成计划后，用此格式将任务交给 Codex。

---

## 交接文件位置

将任务书保存为 `shared/task-bridge.md`，Codex 启动后先读此文件。

## 交接内容

```markdown
# 任务交接：[日期]

## 总体目标
[这次要达成什么，整体背景]

## 任务列表

### T1: [任务标题]
- 文件：`shared/task-briefs/T1-[slug].md`
- 优先级：P1
- 依赖：无

### T2: [任务标题]
- 文件：`shared/task-briefs/T2-[slug].md`
- 优先级：P1
- 依赖：T1 完成后

## 执行顺序

```
T1 → T2 → T3
```

## 全局约束
- 所有任务完成后跑 `npm test`
- 每完成一个任务就交付审查，不要等到全部完成
- 如果遇到规格不清晰的地方，停下来问，不要猜

## 交付物
- [ ] 修改的源代码文件
- [ ] 新增的测试文件（如有）
- [ ] `npm test` 通过截图/输出
- [ ] `shared/handoff-codex-to-claude.md` 交付汇报
```

## 任务书文件组织

建议在项目中建立 `shared/task-briefs/` 目录，每个任务一个文件：

```
shared/
├── task-briefs/
│   ├── T1-add-user-auth.md
│   ├── T2-add-login-page.md
│   └── T3-add-session-middleware.md
├── task-bridge.md      ← Claude 写，Codex 读
└── codex-delivery.md   ← Codex 写，Claude 读
```
