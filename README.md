# Reddit 评论收集器

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FLgw835%2Freddit-ai-assistant&project-name=reddit-ai-assistant&repository-name=reddit-ai-assistant&env=ACCESS_TOKEN%2CDATABASE_URL%2CLLM_CONFIG&envDescription=%E8%AE%BF%E9%97%AE%E4%BB%A4%E7%89%8C%E3%80%81MySQL+%E8%BF%9E%E6%8E%A5%E4%B8%B2%E3%80%81%E5%A4%A7%E6%A8%A1%E5%9E%8B%E9%85%8D%E7%BD%AE%EF%BC%8C%E4%B8%89%E4%B8%AA%E9%83%BD%E5%BF%85%E5%A1%AB&envLink=https%3A%2F%2Fgithub.com%2FLgw835%2Freddit-ai-assistant%2Fblob%2Fmain%2Fserver%2F.env.example)

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

### 一键部署

点这个按钮，Vercel 会自动把仓库复制到你的账号并创建项目，页面上只会问你要三个环境变量：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FLgw835%2Freddit-ai-assistant&project-name=reddit-ai-assistant&repository-name=reddit-ai-assistant&env=ACCESS_TOKEN%2CDATABASE_URL%2CLLM_CONFIG&envDescription=%E8%AE%BF%E9%97%AE%E4%BB%A4%E7%89%8C%E3%80%81MySQL+%E8%BF%9E%E6%8E%A5%E4%B8%B2%E3%80%81%E5%A4%A7%E6%A8%A1%E5%9E%8B%E9%85%8D%E7%BD%AE%EF%BC%8C%E4%B8%89%E4%B8%AA%E9%83%BD%E5%BF%85%E5%A1%AB&envLink=https%3A%2F%2Fgithub.com%2FLgw835%2Freddit-ai-assistant%2Fblob%2Fmain%2Fserver%2F.env.example)

三个变量填什么：

| 变量 | 说明 |
|---|---|
| `ACCESS_TOKEN` | 自己设一串长随机密码，插件里要填同一个值 |
| `DATABASE_URL` | MySQL 连接串，见下方格式 |
| `LLM_CONFIG` | 大模型配置，见下方格式 |

> `ACCESS_TOKEN` 不设的话，服务会拒绝所有请求。这是有意为之：服务一旦上公网，
> 谁拿到域名谁就能读你的收藏库、用你的模型额度，这个令牌是唯一的门锁。

#### DATABASE_URL 怎么写

```
mysql://用户名:密码@主机:端口/库名
```

```
mysql://alice:s3cret@db.example.com:3306/reddit
```

端口可以省略，默认 3306。密码里含 `@ : / ? #` 时要做 URL 转义，
`@` 写成 `%40`、`:` 写成 `%3A`、`/` 写成 `%2F`。

#### LLM_CONFIG 怎么写

三段用竖线 `|` 隔开，顺序固定：

```
Base URL|API Key|模型名
```

比如接 OpenAI：

```
https://api.openai.com/v1|sk-proj-abc123def456|gpt-4o-mini
```

常见服务商照抄这一列改成自己的 Key 就行（模型名以各家文档为准）：

| 服务 | 填进 LLM_CONFIG 的完整内容 |
|---|---|
| OpenAI | `https://api.openai.com/v1\|sk-proj-你的key\|gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1\|sk-你的key\|deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1\|sk-你的key\|qwen-plus` |
| Kimi | `https://api.moonshot.cn/v1\|sk-你的key\|moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4\|你的key\|glm-4-flash` |
| OpenRouter | `https://openrouter.ai/api/v1\|sk-or-你的key\|openai/gpt-4o-mini` |
| 自建 / 中转接口 | `http://1.2.3.4:8317/v1\|你的key\|你的模型名` |

还可以加第四段指定温度，不写默认 0.2（越低越保守，检索场景建议别调高）：

```
https://api.deepseek.com/v1|sk-abc123|deepseek-chat|0.3
```

几个容易踩的点：

- **Base URL 写到 `/v1` 为止**，不要带 `/chat/completions`，那段由程序自己拼。结尾多个斜杠没关系。
- **不要加引号**，整串直接填，`"https://..."` 这样反而会出错。
- **三段都不能空**。接口不需要 Key 时随便填个占位符，比如 `none`。
- 自建接口用 `http://` 没问题，这个请求是服务端发出的，不受浏览器混合内容限制。
- **本地的 Ollama 填不了**。Vercel 上的函数访问不到你电脑上的 `localhost:11434`，
  想用本地模型就改用本地服务模式（`npm run server`）。
- Key 里正好含竖线时改用 JSON 写法：
  `{"baseUrl":"https://api.example.com/v1","apiKey":"a|b","model":"gpt-4o-mini"}`

部署完成后：

1. 复制 Vercel 分配的域名，例如 `https://your-project.vercel.app`
2. 先在浏览器打开 `域名/api/health`，确认返回的 JSON 里 `db.connected` 是 `true`
3. 打开插件侧边栏，填入域名和 ACCESS_TOKEN，点「测试并连接」

### 手动导入（仓库是私有的时候用这个）

一键按钮走的是「复制模板仓库」的流程，源仓库需要是公开的。如果你的仓库是私有的、
按钮报错找不到仓库，改用导入流程：

[在 Vercel 导入这个仓库](https://vercel.com/new/import?s=https%3A%2F%2Fgithub.com%2FLgw835%2Freddit-ai-assistant)

导入时**所有构建设置都保持默认**，只需要在 Environment Variables 里填上面那三个变量。
Vercel 的输入框支持**整段粘贴**：把三行 `KEY=value` 一起贴进 Key 框，会自动拆成三条。

> 仓库根目录和 `server/` 下各放了一份入口，所以 Root Directory 留空或填 `server` 都能部署成功。

### 其它说明

- 函数区域已在 `server/vercel.json` 里设为新加坡 `sin1`，离国内的数据库和常见的 AI 接口都比较近。
- 数据表在第一次请求时自动创建，不需要手动建。
- **云端部署后，数据库连接信息只能在 Vercel 环境变量里改**，插件设置页里那几个框会变成只读；
  大模型配置仍可在插件里随时改，改动存进数据库的 `settings` 表。
- 想单独换模型而不重写整串，加一条 `LLM_MODEL` 即可，单项变量优先级高于 `LLM_CONFIG`。
  同理还有 `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` `LLM_BASE_URL` `LLM_API_KEY` `LLM_TEMPERATURE`。
- **部署后访问 `/api/health` 是 404** —— 说明函数没被部署出来。到 Vercel 项目的
  Settings → Build & Deployment → Root Directory，留空或填 `server`，保存后重新部署
  （Deployments 页最新一条右侧菜单里的 Redeploy）。
- Vercel 免费版单次请求最长 60 秒，超长回答可能被截断；回答是流式返回的，
  但云端可能整体缓冲后一次性送达，看起来像"想了一会儿突然全部出现"。

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
npx tsx tools/test-vercel-handler.mts --root      # 测仓库根目录的部署入口
```

目录：

```
extension/         扩展（Manifest V3 + TypeScript + Vite）
  src/content/     注入 Reddit 页面：解析评论、注入收藏按钮、展开、高亮
  src/sidepanel/   右侧面板：对话 / 收藏库 / 设置
  src/background/  service worker：侧栏、右键菜单、代发桥接请求
api/index.ts       Vercel 入口（根目录部署时用）
vercel.json        根目录部署配置
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
