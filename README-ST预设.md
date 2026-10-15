# dsh-st-preset — 真的像 ST 的预设（按窗口）

把 SillyTavern 的**聊天补全预设原样**接进 DSH：条目列表、📌 分区、🔀 多选一、逐条开关，
**每个窗口（Session）各管一份**，并且因为是在系统提示词的组装阶段注入，**工具调用那一轮同样带着预设**。

## 装在哪

| 位置 | 内容 |
|---|---|
| `/root/dsh-st-preset/index.js` | Host 半：解析 ST 预设、按窗口存状态、组装系统提示词、`POST /api/st-preset` |
| `/root/dsh-st-preset/client.js` | Client 半：输入框左侧「预设」按钮 + 设置页「ST 预设」 |
| `/root/dsh-st-presets/*.json` | **你的 ST 预设文件**，原样丢进来即可（已放入 `智脑-Z（10.1）.json`） |
| `/root/.dsh/st-presets/state.json` | 每窗口状态（自动生成） |
| `/root/dsh-st-preset/insert.patch.yml` | 可自由插拔的声明片段（当前已插入 profile） |

当前 profile 补丁里已插入：

```yaml
- insert:
    - id: st-preset
      name: /root/dsh-st-preset/index.js
      config:
        presetsDir: /root/.dsh/st-presets
```

删掉这一段即卸载；换目录只改 `presetsDir`。**没有走 `install_bundle`**，所以不需要 DSHA 原生审阅，
也没有装任何新包——它只是把已装好的 `systemPrompt` / `connection` 服务接起来用。

## 怎么用

1. 刷新 DSH 网页（必要时强刷一次）。
2. 输入框左下角出现「**预设**」按钮（或 设置 → **ST 预设** 页）。
3. 下拉选「智脑-Z（10.1）」→ 逐条开关（🔀 开一个会自动关掉同组其它项）。
4. 改动只作用于**当前窗口**；换个窗口要先在那里选预设。

## 与 ST 的对应关系

| ST | 这里 |
|---|---|
| 预设文件（.json） | `st-presets/*.json`，结构不动，`prompt_order` / `prompts` 原样读 |
| 条目列表 + 开关 | 面板里的开关，状态按 Session 存 |
| 📌 分区 | 面板里的分组标题 |
| 🔀 多选一 | 同组互斥（按条目名归组） |
| `{{setvar}}` / `{{getvar}}` / `{{trim}}` / `{{//注释}}` | 组装时**按顺序静态展开**（同 ST 的构建时机） |
| `{{user}}` / `{{char}}` | → 玩家 / 角色 |
| 预设只影响本轮上下文 | **每次模型步现算**，所以工具调用轮也在 |

## 已知没做的

- **13 条正则显示脚本**（思维链、时空栏、正文去壳、剧情选项…）没搬：那是 ST 的输出后处理层，
  DSH 的对话渲染由 Conversation 层拥有，另外写渲染器是另一个工程。
- **运行时变量回写**：ST 里模型 `<UpdateVariable>` 写回、下轮 `{{getvar}}` 再注入；这里只做构建期展开，
  「世界图谱/记忆链/剧情大总结」等槽位不会随对话累积。
- **条目正文编辑**：面板目前只开关，`✏️` 条目的文本编辑（`text` 覆盖）Host 侧已支持、UI 还没接。
- 采样参数（temperature/top_p…）不在预设里，仍由 DSH 模型设置管。

## 自测

```
node /root/dsh-st-preset/selftest.mjs
```

覆盖：预设发现 / 未选不注入 / 条目与分区解析 / 默认开关来自 ST 快照 / 宏全展开 /
关条目后正文变短 / 窗口隔离 / 多选一互斥 / 还原。当前 17 项全通过。

## 推到 GitHub（这台手机的坑）

本机 DNS 把 `github.com` / `api.github.com` 污染到假 IP，直连 TLS 被重置，必须借手机上的代理：

```bash
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
git -C /root/dsh-st-preset push
```

`origin` = `https://github.com/baiyixing12/dsh-st-preset.git`（private），分支 `main`。
令牌只以 `-c http.extraheader=AUTHORIZATION: basic …` 单次传入，**不落 `.git/config`、不写进 remote URL**。

## 自己导入 / 更换（不需要经过 agent）

面板顶栏四个按钮：**下拉选预设** / **导入** / **删除** / **重载**。

- **导入**：点一下弹出手机的文件选择器，选任意 ST 聊天补全预设 `.json`（爱从哪来从哪来：Download、微信、网盘），
  上传后 Host 落盘到预设目录并**自动为当前窗口选中**。
- **删除**：删掉当前预设**文件**（会二次确认）；正在用它的窗口回落到「不使用预设」。
- **重载**：手动把文件丢进预设目录后，用这个重新扫描。
- 校验与安全：必须是含 `prompts` 数组的 ST 预设，否则拒绝；文件名做净化（`../`、路径分隔符、控制字符都会被清掉），
  只允许在预设目录内增删；同名导入会返回冲突，确认后覆盖；带 BOM 的 JSON 也能读。

界面之外，预设文件本身就是真相：目录里的 `*.json` 随时可被外部工具增删改，点「重载」即可见。

## 条目正文就地编辑（✏️）

每条条目右侧「**改**」按钮 → 展开文本框，改完「存到本窗口」/「还原原文」/「取消」。

- 覆盖只存**本窗口**（`state.json` 的 `text`），不动预设文件；条目名旁会出现「已改」标记。
- 还原 = 删掉该条覆盖，回到预设原文；「还原本窗口改动」按钮会一次清掉所有开关 + 正文覆盖。
- 正文里的 `{{setvar}}` / `{{getvar}}` 仍按 ST 语义在构建期展开，所以改文本时可以直接写这些宏。

## 预设改名

顶栏「**改名**」→ 改的是预设的**显示名**（写进 JSON 的 `name` 字段，下拉框里显示它）。
文件名 / id 不变，因此窗口状态、`{{getvar}}` 之类都不受影响；空名和非法 id 会被拒。
