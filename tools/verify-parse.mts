/**
 * 用保存下来的 Reddit 页面快照验证内容脚本的 DOM 解析逻辑。
 * 运行： npx tsx tools/verify-parse.ts Reddit.html
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const file = process.argv[2] ?? 'Reddit.html';
const html = readFileSync(resolve(process.cwd(), file), 'utf8');

const dom = new JSDOM(html, { url: 'https://www.reddit.com/r/Coffee/comments/c05afs/x/' });
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.location = dom.window.location;
g.Element = dom.window.Element;
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.CSS = dom.window.CSS ?? { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };

const { collectPageContext, parsePost } = await import('../extension/src/content/reddit-dom.ts');

const post = parsePost();

// jsdom 对浏览器另存的快照容错与 Chrome 不同，可能丢掉整棵评论树。
// 这里直接把原文里的评论区片段重新注入，专门验证属性与正文的解析逻辑。
if (dom.window.document.querySelectorAll('shreddit-comment').length === 0) {
  const start = html.indexOf('<shreddit-comment ');
  const end = html.lastIndexOf('</shreddit-comment>');
  if (start >= 0 && end > start) {
    const holder = dom.window.document.createElement('div');
    holder.innerHTML = html.slice(start, end + '</shreddit-comment>'.length);
    dom.window.document.body.appendChild(holder);
    console.log('[提示] 已从原始 HTML 重新注入评论区片段用于验证\n');
  }
}

const ctx = collectPageContext();

console.log('=== 帖子 ===');
console.log({
  id: post?.id,
  subreddit: post?.subreddit,
  author: post?.author,
  title: post?.title,
  url: post?.url,
  numComments: post?.numComments,
  bodyPreview: (post?.bodyText ?? '').slice(0, 80),
});

console.log('\n=== 评论 ===');
console.log('解析到', ctx.comments.length, '条；isPostPage =', ctx.isPostPage);
for (const c of ctx.comments.slice(0, 3)) {
  console.log('---');
  console.log({
    id: c.id,
    author: c.author,
    depth: c.depth,
    score: c.score,
    created: c.createdUtc,
    url: c.url,
    parentExcerpt: (c.parentExcerpt ?? '').slice(0, 40),
    body: (c.bodyText ?? '').slice(0, 90),
  });
}

const missing = ctx.comments.filter((c) => !c.bodyText || !c.permalink || !c.author);
console.log('\n字段缺失的评论数：', missing.length);
if (missing.length) console.log(missing.slice(0, 3));
