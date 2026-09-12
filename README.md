# Reddit 评论收集器

一个 Chrome / Edge 扩展 + 可自部署的后端服务：在 Reddit 上一键收藏评论到自己的 MySQL 数据库，并在浏览器右侧用 AI 对话，从**当前页面**和**收藏库**里找出对应的评论，回答中带可点击的引用，点一下就跳回原评论并高亮。

## 它能做什么

- **单条收藏**：鼠标移到任意评论上，正文右上角出现「＋ 收藏」，点击即存入数据库（作者、正文、赞数、时间、父评论摘录、permalink 定位链接、所属帖子）。已收藏的评论下次打开会自动标记，再点一次可取消。
- **整帖收藏**：帖子顶部工具条一键把当前已加载的全部评论入库。
- **展开全部评论**：循环点击页面上的「更多回复」，把折叠的楼层全部展开后再采集，长帖检索质量靠它。
- **AI 对话检索**：右侧面板输入需求，可选检索范围（当前页面 / 收藏库 / 两者）。回答里的引用是可点击的芯片，当前页直接滚动高亮，跨帖的自动开新标签页定位。
- **收藏库管理**：搜索、按版块 / 作者 / 标签筛选，加备注、打标签、删除，导出 Markdown 或 JSON。
- **划词收藏**：选中文字右键「收藏选中内容到 Reddit 库」，选中的片段会存进备注。
- **快捷键**：`Alt+R` 打开侧边栏，`Alt+S` 收藏鼠标当前所在的评论。

## 服务放在哪里

浏览器扩展不能直接连 MySQL（没有原始 TCP 能力），所以数据库和大模型调用都由一个 Node 服务负责。这个服务有两种跑法，插件里填哪个地址就用哪个：

```
Chrome 扩展  ──HTTPS──▶  Vercel 上的服务  ──▶  MySQL
                                      └──▶  大模型（OpenAI 兼容接口）
或
Chrome 扩展  ──HTTP───▶  本机 127.0.0.1:8787（npm run server）
```

| | 本地 | Vercel |
|---|---|---|
| 启动 | 每次用之前要开着终端 | 一直在线，换电脑也能用 |
| 配置 | 插件设置页里填数据库 | 在 Vercel 环境变量里填 |
| 安全 | 只监听本机 | **必须设 ACCESS_TOKEN** |

## 部署到 Vercel

1. 把项目推到 GitHub（`add.txt`、`server/.env` 已在 .gitignore 里，凭据不会上传）。
2. 在 Vercel 点 **Add New → Project**，导入这个仓库。
3. **Root Directory 选择 `server`**，其余保持默认，先不要点 Deploy。
4. 展开 **Environment Variables**，填入下面 3 个变量：

   | 变量 | 格式 |
   |---|---|
   | `ACCESS_TOKEN` | 自己设一串长随机密码，插件里要填同一个值。**不设的话服务会拒绝所有请求** |
   | `DATABASE_URL` | `mysql://用户名:密码@主机:端口/库名` |
   | `LLM_CONFIG` | `Base URL|API Key|模型名`，用竖线分隔，Base URL 以 `/v1` 结尾 |

   Vercel 的环境变量框支持**整段粘贴**：把三行 `KEY=value` 一起贴进 Key 输入框，会自动拆成三条。
   密码里含 `@ : / ? #` 时要做 URL 转义（`@` 写成 `%40`）。

   想单独控制某一项时，也可以改用展开写法（`DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、
   `DB_PASSWORD`、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_TEMPERATURE`）。
   两种写法可以混用，单独设置的变量优先级更高，会覆盖合并变量里的对应项。

5. 点 Deploy，完成后复制分配的域名，例如 `https://your-project.vercel.app`。
6. 打开插件侧边栏，填入域名和 ACCESS_TOKEN，点「测试并连接」。

几个部署上的注意点：

- 函数区域已在 `server/vercel.json` 里设为新加坡 `sin1`，离国内的数据库和常见的 AI 接口都比较近。
- 数据表在第一次请求时自动创建，不需要手动建。
- **云端部署后，数据库连接信息只能在 Vercel 环境变量里改**，插件设置页里那几个框会变成只读；大模型配置仍可在插件里随时改，改动存进数据库的 `settings` 表。
- Vercel 免费版单次请求最长 60 秒，超长回答可能被截断；回答是流式返回的，但云端可能整体缓冲后一次性送达，看起来像"想了一会儿突然全部出现"。
- 服务部署在公网就意味着谁拿到域名谁就能访问，`ACCESS_TOKEN` 是唯一的门锁，别设成简单字符串，也别把它提交进仓库。

## 安装

```bash
# 1. 安装依赖（根目录一次装齐）
npm install

# 2. 构建扩展
npm run build

# 3. 如果用本地服务再执行这步（用 Vercel 就跳过）
npm run server
```

然后在浏览器里加载扩展：

1. 打开 `chrome://extensions`（Edge 是 `edge://extensions`）
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择 **`extension/dist`** 目录
4. 打开任意 Reddit 帖子页，点工具栏图标或按 `Alt+R` 打开右侧面板

> Windows 下可以直接双击 `start-server.cmd` 启动服务。

## 首次配置

打开侧边栏，会先看到**连接页**，必须验证通过才进得去对话界面：

- **用 Vercel**：填域名 + ACCESS_TOKEN，点「测试并连接」。浏览器会弹出一次域名授权，点「允许」。
- **用本地服务**：点「用本地服务」，自动填入 `http://127.0.0.1:8787` 并测试。

「测试并连接」会依次检查：域名可达 → 是不是本插件的接口 → 令牌对不对 → 数据库通不通。任何一步失败都会说明具体原因，不会放行。

连接成功后进「设置」页还可以调整：

| 区块 | 说明 |
|---|---|
| 服务连接 | 显示当前地址，可「重新检测」或「更换服务地址」 |
| MySQL | 本地部署时可填写并测试；云端部署时只读，改环境变量 |
| 大模型接口 | Base URL、API Key、模型名，随时可改，存进数据库 `settings` 表 |
| 检索参数 | 页内全量阈值、精选条数等，默认值即可 |

## 数据表

服务启动或保存数据库配置时自动创建，已存在则不动：

| 表 | 用途 |
|---|---|
| `posts` | 帖子（标题、版块、作者、链接、正文） |
| `comments` | 评论（正文、作者、permalink、层级、赞数、父评论摘录、备注、来源），正文有全文索引 |
| `tags` / `comment_tags` | 标签 |
| `chat_sessions` / `chat_messages` | AI 对话历史与引用记录 |
| `settings` | 大模型与检索参数 |

## 日常用法

1. 打开一个 Reddit 帖子，先点「展开全部评论」（长帖尤其重要）。
2. 看到有价值的评论就点「＋ 收藏」；想整帖留档就点「收藏整帖评论」。
3. 按 `Alt+R` 打开面板，选好检索范围，用自然语言提问，例如
   「谁在讨论手冲水温？」「有哪些人不推荐这台机器，理由是什么？」
4. 回答里点任意引用芯片，页面会滚动到那条评论并闪烁高亮。
5. 需要复盘时去「收藏库」搜索、加备注、导出 Markdown。

## 开发

```bash
npm run build        # 构建扩展到 extension/dist
npm --workspace extension run watch   # 监听重建（改完在扩展页点刷新）
npm run server:dev   # 服务热重载
npx tsx tools/verify-parse.mts Reddit.html   # 用页面快照验证 DOM 解析逻辑（快照需自行另存，仓库未包含）
npx tsx tools/test-citations.mts             # 验证引用 ID 的纠错逻辑
npx tsx tools/test-env-bundles.mts           # 验证合并写法的环境变量解析
npx tsx tools/test-vercel-handler.mts        # 在本机模拟 Vercel 环境跑通整套接口
npx tsx tools/test-vercel-handler.mts --bundled   # 同上，但只用 3 个合并变量
```

目录：

```
extension/         扩展（Manifest V3 + TypeScript + Vite）
  src/content/     注入 Reddit 页面：解析评论、注入收藏按钮、展开、高亮
  src/sidepanel/   右侧面板：对话 / 收藏库 / 设置
  src/background/  service worker：侧栏、右键菜单、代发桥接请求
server/            后端服务（Fastify + mysql2），本地与 Vercel 共用一套代码
  src/app.ts       应用工厂：CORS、令牌校验、路由、数据库连接
  src/index.ts     本地入口（npm run server）
  api/index.ts     Vercel Serverless 入口
  src/routes/      数据库、设置、帖子、评论、对话（SSE 流式）接口
  vercel.json      部署配置（区域、超时、路由重写）
tools/             验证脚本：页面解析、引用修复、Vercel 入口
```

## 常见问题

**连接页一直过不去** —— 先在浏览器里直接打开 `你的域名/api/health`，能看到一段 JSON 才说明服务活着。若提示要令牌，检查 Vercel 环境变量 `ACCESS_TOKEN` 与插件里填的是否完全一致（改了环境变量要重新部署）。

**提示"部署在公网但没有设置 ACCESS_TOKEN"** —— 这是有意拦截：没有令牌的公网服务等于把数据库和模型额度对所有人开放。去 Vercel 加上这个变量并重新部署。

**面板顶部提示连不上服务** —— 本地服务没启动，执行 `npm run server`；云端则检查部署是否成功。

**评论上没有出现收藏按钮** —— 扩展刚加载时已打开的页面需要刷新一次；确认地址是 `https://www.reddit.com/...`。

**AI 说找不到相关评论** —— 先点「展开全部评论」再问；或把检索范围切到「当前页面 + 收藏库」。

**点引用没有跳转** —— 该评论不在当前页时会自动新开标签页并带 `rc_highlight` 参数定位。ID 对不上时还会用「作者 + 原文片段」再找一次。若引用芯片显示为灰色删除线，说明模型给的标记不在候选评论里，这类引用不可信，回答里对应的那一点要打个问号。

**怎么判断回答可不可信** —— 每个要点都会带一段原文摘录（保持英文原文），摘录要求与原文逐字一致；点引用跳到原帖即可核对。服务端还会校验模型写出的每个引用 ID，能修的自动修正，修不了的在回答下方列出来。

**老版 Reddit（old.reddit.com）** —— 当前只适配新版 `shreddit` 页面结构。
