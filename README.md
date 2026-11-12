# Sibyl

![Sibyl：女预言者望向聊天窗口里的三条建议](assets/sibyl.png)

让你的 Agent 在每轮结束时，替你预测下一句要说什么。

> Sibyl（西比尔）是古希腊传说里的女预言者。

> **现状**：规范、参考核心和一致性用例已经齐了，参考核心通过了全部用例；还没有任何 Agent 照规范给自己装过。

## 它做什么

Agent 每干完一轮，就站在你的角度想想你接下来最可能说什么，然后在原来的对话里列出来：

```
Sibyl: 你可能想说
1. 跑一下测试
2. 顺便把 README 也更新一下
3. 提交并推送到 main
```

回一个数字，就等于说了那句话。

打开 `act` 模式后，像「跑一下测试」这种只是接着当前工作往下走的一步，它会自己接着做，默认最多连做 3 步。推送、发布、删除、花钱、碰凭据，或者需要你选方向的事，它只列出来，不替你做。

## 它怎么做到的

预测由 Agent 自己来做：同一个 Agent，同一段上下文，用上它已经知道的一切，包括这段对话、手头工作的进展，以及你在指令文件和记忆里留下的习惯。Sibyl 只在外面加三样东西：

- **一个结束时的触发**：一轮结束时，如果这个会话开着 Sibyl，就先不让这一轮结束，把 `PREDICT.md` 的正文交给 Agent，请它预测完再结束。这一步不调任何模型，也不联网。
- **`/predict` 命令**：按会话开关。
- **`PREDICT.md`**：头部写配置，正文写给 Agent 的说明。

规范不点名任何工具。它只描述 Sibyl 需要环境提供的四种能力：
1. 一轮结束时能让 Agent 接着干的机制；
2. 按会话保存的状态；
3. 放 `PREDICT.md` 的地方；
4. 接收 `/predict` 的通道。

在你的环境里这四样分别是什么，由安装它的 Agent 自己去找。本机的命令行工具、云端的 Agent、架构未知的 Agent 都一样。

- 能找到第 1 种能力，就是 **L2**：每轮结束都会可靠触发。
- 找不到，就退到 **L1**：把说明写进 Agent 常驻的指令里，效果靠它自觉。

## 安装

对你的 Agent 说一句：

> Install Sibyl for yourself according to https://github.com/susyimes/sibyl/blob/main/SPEC.md

它会做这些事：

1. 先查清自己的环境能提供什么，告诉你能装到哪一档；
2. 用参考核心，或者把它移植成自己环境的语言；
3. 把它接到自己的结束机制上，再装好命令和默认的 `PREDICT.md`。原有的配置只合并、不替换，所有改动都会记下来，方便撤销。需要你批准或信任的地方，它会停下来请你来做。

**验收**，三条都满足才算装好：
1. 核心通过 `conformance/cases.jsonl` 的全部用例。
2. 在真实环境里实际看到四件事：
   - 关着时正常结束，对话里看不到 Sibyl 的任何痕迹，状态存储也没被改动；
   - `/predict on` 之后，下一轮以 `Sibyl:` 建议块结尾；
   - 你再发一条消息，计数重新开始；
   - 状态存不了的时候，这一轮照样正常结束。
3. 停用和重新启用：`/predict disable` 之后，改过的配置文件和安装前的备份逐字一致，Agent 的表现和安装前一样；再说一遍安装那句话，又能用了。

装不上时，它会撤销改动，并告诉你卡在哪一步、现在还能用哪一档、要装到 L2 还缺什么。

## 使用

| 命令 | 作用 |
|---|---|
| `/predict on` | 在当前会话开启（默认 `suggest`：只列出预测） |
| `/predict on act` | 开启，并允许它自己接着做明显的下一步 |
| `/predict off` | 在当前会话关闭 |
| `/predict status` | 查看档位、生效的 `PREDICT.md` 和开着的会话 |
| `/predict disable` | 全局停用：把 Sibyl 从 Agent 的配置里整个撤出去 |
| `/predict uninstall` | 停用，并删掉 Sibyl 自己的文件 |

Sibyl 默认关闭。`on` / `off` 只影响你输入命令的那个会话。

**关闭时完全不起作用**，分两档：

- **`/predict off`**：只关当前会话。每轮结束时还会做一次很快的开关检查，但不往模型里送任何东西，不输出，也不写文件，对话和没装时一样。（L1 例外：那段说明每轮都会被读到，要完全不起作用得用 `disable`。）
- **`/predict disable`**：全局停用。撤掉 Sibyl 在 Agent 配置里的全部登记，改过的配置文件恢复成安装前的样子。Sibyl 自己的文件和改动记录留在它自己的目录里，不起作用。想重新启用，把安装那句话再说一遍就行：它会根据改动记录把登记加回去，不用重装。

## 配置：`PREDICT.md`

Sibyl 按以下顺序取第一个存在的：
1. 项目级的 `PREDICT.md`；
2. 用户级的 `PREDICT.md`；
3. 内置默认，也就是 [PREDICT.md](PREDICT.md) 这份。

改完下一轮就生效。

```markdown
---
default_on: false     # 新会话是否默认开启
mode: suggest         # suggest：只列出 | act：明显的下一步可以自己接着做
max_auto_turns: 3     # act 模式下最多连做几步，到了就停下来列出建议
---
（给 Agent 的说明：怎么预测、什么情况只列出不做……）
```

## 为什么这样设计

Sibyl 的前作是 [intent-predict](https://github.com/susyimes/intent-predict)，它从会话外面猜你的下一句。为此它需要：
- 好几家 Agent 的适配器、历史同步和会话绑定；
- 每轮额外调一次模型，要等十几到几十秒；
- 在另一个网页里显示建议，离你打字的地方很远。

其实 Agent 自己手里的信息最全，所以 Sibyl 让它自己观察自己，外面只留一个触发、一个开关和一份说明。

设计遵循 [AGENT.md](https://github.com/susyimes/agent-coding-principle/blob/main/AGENT.md) 的原则：
- 不限制模型的判断，预测什么由 Agent 决定；
- 规则少而松，只保留保护你的几条：默认关闭；预测不等于你的同意；有外部影响的只列不做；自己接着做有步数上限；出错就正常结束；
- 限制都是显式的，可以关掉；
- 风险摆出来给你看，不藏起来。

## 仓库地图

| 路径 | 内容 |
|---|---|
| [SPEC.md](SPEC.md) | 规范，写给安装 Sibyl 的 Agent。附录 A 是默认 `PREDICT.md` |
| [PREDICT.md](PREDICT.md) | 默认的 `PREDICT.md` |
| [reference/sibyl_core.mjs](reference/sibyl_core.mjs) | 参考核心：读 `PREDICT.md`、决定是否继续、识别 Agent 是否已经给出建议。只有纯函数，不读写文件，不联网，也不针对任何工具 |
| [conformance/cases.jsonl](conformance/cases.jsonl) | 一致性用例（47 条），只是数据，跟实现语言无关 |
| [assets/sibyl.png](assets/sibyl.png) | 项目图（用 gpt-image-2.6 生成） |
| [conformance/run.mjs](conformance/run.mjs) | 拿用例检验参考核心，并检查三处默认模板是否一致。用法：`node conformance/run.mjs`（Node ≥ 18，无依赖） |

## 下一步

1. 先挑一个 Agent，照 [SPEC.md](SPEC.md) 给自己装上，走完两条验收。
2. 再换一个架构不同的 Agent 试一次，比如云端的。两次安装里遇到的歧义，都改进规范。
3. 用一段时间，看预测准不准、`act` 模式会不会自作主张，再决定要不要调整默认值。

## 许可证

MIT
