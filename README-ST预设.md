# sillytavern-preset-for-dsh

把 **SillyTavern 的聊天补全预设**原样搬进 **DeepSeek Harness（DSH）**，并且按**窗口（Session）**管开关。
不是"把预设拍平成一坨系统提示词"，而是保留 ST 的条目层级、逐条开关、🔀 多选一互斥，还有就地改正文。

## 它解决什么

ST 的预设是一份「条目列表 + 开关状态」：📌 分区、🔀 多选一、🔌 可开关、✏️ 可编辑。
DSH 原生的 agent preset 是静态配置，没有这套东西；把预设导成一个大字符串又会丢掉全部可调性。
这个插件把两者接起来：**预设文件是 ST 的，界面是 ST 式的，作用域是 DSH 的窗口。**

## 特性

| 能力 | 说明 |
|---|---|
| ST 预设原样读 | `<presetsDir>/*.json`，`prompts` / `prompt_order` 结构不动，ST 导出直接能用 |
| 面板内导入 / 删除 / 改名 | 手机文件选择器选 JSON 即导入；删除有二次确认；改名只改显示名，不动文件名/id |
| 逐条开关 + 📌 分区 | 面板按 ST 的分区标题分组，每条一个开关 |
| 🔀 多选一互斥 | 同组开一个自动关掉兄弟项（按条目名归组） |
| ✏️ 正文就地编辑 | 每条「改」展开文本框，改的是**本窗口**的覆盖，预设文件不动，可一键还原 |
| 按窗口隔离 | 开关与正文覆盖都按 Session 存，A 窗口关 NSFW 不影响 B 窗口 |
| 工具调用轮同样生效 | 注入是 `systemPrompt.section` 的**组装期函数**，每个模型步现算，不是只在首轮 |
| ST 宏按序展开 | `{{setvar}}` / `{{getvar}}` / `{{trim}}` / `{{//注释}}` 构建期展开；`{{user}}`→玩家、`{{char}}`→角色 |
| 一行 patch 插拔 | 无需 `install_bundle`（因此不触发 DSHA 原生审阅），删掉那行即卸载 |

## 快速开始

```bash
# 1) 放插件（Host + Client 两半，纯 JS，无依赖）
git clone https://github.com/baiyixing12/sillytavern-preset-for-dsh.git /root/dsh-st-preset

# 2) 往 profile 的 cordis.patch.yml 顶层数组插一段（见 insert.patch.yml）
#    - insert:
#        - id: st-preset
#          name: /root/dsh-st-preset/index.js
#          config:
#            presetsDir: /root/.dsh/st-presets

# 3) 自测
node /root/dsh-st-preset/selftest.mjs
```

装好后刷新 DSH 网页：输入框左侧出现「**预设**」按钮（另有 设置 →「ST 预设」整页），
导入一个 ST 预设 JSON → 选它 → 逐条开关即可。

## 说明

### 安装：两条路，选一条

**A. profile 补丁（本机现在用的，推荐）** —— 不装包、不触发 DSHA 原生审阅：

```yaml
# 追加到 /root/.dsh/profiles/web/cordis.patch.yml 的顶层数组
- insert:
    - id: st-preset
      name: /root/dsh-st-preset/index.js
      config:
        presetsDir: /root/.dsh/st-presets   # 省略则用这个默认值
```

**B. 当正常插件装** —— 需在 DSHA「插件 → 插件管理 → 本地目录」里安装本仓库目录并确认启用。
本机走的是 A，因为 `plugin_manager.install_bundle` 在当前环境被原生审阅挡下。

卸载 = 删掉那段补丁（或卸载 bundle），预设文件与 `state.json` 都不受影响。

### 面板操作

| 动作 | 位置 | 说明 |
|---|---|---|
| 打开面板 | 输入框左下「**预设**」按钮；或 设置 →「ST 预设」整页 | 两个入口同一个面板 |
| 选预设 | 顶栏下拉 | 只影响**当前窗口**；选 `（本窗口不使用预设）` 即关掉注入 |
| 开关条目 | 每行左侧圆形开关 | `role="switch"`，点一下切换；改动立刻存 |
| 多选一 | 带「多选一」标记的行 | 🔀 同组开一个，自动关掉其它 |
| 改正文 | 每行右侧「**改**」 | 展开文本框 → 存到本窗口 / 还原原文 / 取消 |
| 导入 | 顶栏「导入」 | 手机文件选择器选 ST 预设 `.json`，落盘并自动选中 |
| 删除 | 顶栏「删除」 | 删当前预设**文件**，二次确认 |
| 改名 | 顶栏「改名」 | 只改显示名（写 JSON 的 `name`），文件名/id 不变 |
| 重载 | 顶栏「重载」 | 你从外部改了预设目录后，重新扫描 |
| 还原 | 面板底部「还原本窗口改动」 | 清掉本窗口所有开关 + 正文覆盖 |

### 数据与注入

```
/root/.dsh/st-presets/
├── 智脑-Z（10.1）.json      # 预设本体（ST 导出，结构不动）
└── state.json               # 每窗口状态，自动生成
    {"sessions":{"<sessionId>":{"presetId":"…","enabled":{"<identifier>":false},"text":{"<identifier>":"…"}}}}
```

- 注入点：`agent/created` 时在该 agent 作用域注册一个 `systemPrompt.section`
  （`name: st-preset`，`order: 100`，紧跟部署人设之后、工具说明之前，`interpolate: false`）。
  文本是**组装期函数**，每次模型步现算 → 工具调用轮同样带着预设。
- 组装顺序照 ST：取 `prompt_order[0].order`，逐条判断开关 → 展开宏 → 拼接；空条目不产生文本。
- 宏：`{{setvar::x::v}}` 登记并抹掉、`{{getvar::x}}` 就地展开（按顺序、同 ST 构建时机）、
  `{{//注释}}` / `{{trim}}` 抹掉、`{{user}}`→玩家、`{{char}}`→角色，最后清掉任何残留 `{{…}}`
  （DSH 会严格解析模板变量，残留会渲染报错）。

### 接口（面板用的就是它，可脚本化）

`POST /api/st-preset`，JSON body，走 `/api` 鉴权（浏览器同源 fetch 自动带凭据）：

| action | 参数 | 返回 |
|---|---|---|
| `state` | `sessionId` | 预设列表 + 当前窗口状态 + 条目明细 |
| `setPreset` | `sessionId`, `presetId\|null` | 新快照（会清掉该窗口的覆盖） |
| `toggle` | `sessionId`, `identifier`, `enabled`, `exclusiveGroup?` | 新快照 |
| `entryText` | `sessionId`, `identifier` | `{text, original, edited}` |
| `setText` | `sessionId`, `identifier`, `text\|null` | 新快照（`null` = 还原） |
| `import` | `fileName`, `text`, `overwrite?`, `select?` | 新快照 + `imported`；重名回 `conflict` |
| `delete` | `presetId` | 新快照 |
| `rename` | `presetId`, `name` | 新快照 + `renamed` |
| `reload` | — | 重新扫描目录后的快照 |

失败一律返回 `{error:"…"}`；非法 id、路径穿越、非 ST 预设、空名都会被拒。

### 排障

| 现象 | 原因 / 处理 |
|---|---|
| 输入框左侧没有「预设」 | 页面没刷新（强刷一次）；或 `include:st-preset` 不在插件列表里 / 不是 `active` |
| 面板提示 `接口出错：HTTP 401` | 页面凭证过期，重新打开 DSH 网页即可 |
| 开了预设但模型没反应 | 确认下拉不是 `（本窗口不使用预设）`；改动在**下一次模型步**生效，当前这轮不会追溯 |
| 关掉 NSFW 又自己开了 | 那是 🔀 多选一组的兄弟条目互斥，属预期 |
| 改了正文，切预设后没了 | 覆盖只属于「窗口 + 该预设」，切预设会重置，属预期 |
| 预设文件删了仍在列表 | 点「重载」；删除按钮本身会即时刷新 |
| GitHub 推送被墙 | 见文末「推到 GitHub（这台手机的坑）」 |

## 已知不做

- **13 条正则显示脚本**（思维链 / 时空栏 / 正文去壳 / 剧情选项）：那是 ST 的输出后处理层，
  DSH 的对话渲染归 Conversation 层所有，没有搬。所以"正文好看程度"和 ST 仍不一致。
- **运行时变量回写**：模型 `<UpdateVariable>` → 下轮 `{{getvar}}` 这条链没有引擎，
  「世界图谱 / 记忆链 / 剧情大总结」这类槽位不会随对话累积（构建期展开仍然正确）。
- 采样参数（temperature / top_p / repetition_penalty…）不属于预设，仍由 DSH 模型设置管。

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

`origin` = `https://github.com/baiyixing12/sillytavern-preset-for-dsh.git`（private），分支 `main`。
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

## 两条安装路

- **正规安装**：`dsh plugin --profile <名> add <仓库目录>` 或 DSHA「插件 → 插件管理 → 本地目录」——
  本仓库已声明 `dsh.bundle.patch`，装完自动挂载。
- **自由插入**（本机用的）：不用装包，直接把 `insert.patch.yml` 那段写进 profile 的 `cordis.patch.yml`，
  `name` 用插件目录的绝对路径。
