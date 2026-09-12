import { resolveCitations, applyRepairs } from '../server/src/retrieval.ts';
import type { RetrievalCandidate } from '../server/src/retrieval-types.ts';

const mk = (id: string, author: string): RetrievalCandidate => ({
  id, author, text: 'body of ' + id, url: 'https://www.reddit.com/c/' + id,
  postTitle: 'P', subreddit: 'r/Coffee', note: '', score: 1, origin: 'page', rank: 0,
});

const candidates = [
  mk('t1_er1eg7q', 'Edith_avian_f'),
  mk('t1_er1koaq', 'Upbeat_Housing7421'),
  mk('t1_er1lut2', 'othernes'),
  mk('t1_er22oll', 'othernes'),
];

const cases: [string, string][] = [
  ['作者名当 ID', 'u/Edith 说 [[cite:Edith_avian_f]]。'],
  ['带 u/ 前缀', '见 [[cite:u/Upbeat_Housing7421]]。'],
  ['裸 id 无前缀', '见 [[cite:er1koaq]]。'],
  ['序号', '见 [[cite:2]]。'],
  ['正确 id', '见 [[cite:t1_er1lut2]]。'],
  ['同名作者多条', '见 [[cite:othernes]]。'],
  ['完全无效', '见 [[cite:不存在的东西]]。'],
  ['尾部标点', '见 [[cite:t1_er1eg7q.]]。'],
];

let pass = 0;
for (const [name, answer] of cases) {
  const r = resolveCitations(answer, candidates);
  const fixed = applyRepairs(answer, r.repairs);
  const ok = name === '完全无效' ? r.unresolved.length === 1 : r.cited.length === 1 && r.unresolved.length === 0;
  if (ok) pass++;
  console.log((ok ? '✓' : '✗') + ' ' + name.padEnd(12) + ' -> cited=' +
    r.cited.map(c => c.id).join(',') + ' | unresolved=' + r.unresolved.join(',') +
    ' | 修正后: ' + fixed.trim());
}
console.log('\n通过 ' + pass + '/' + cases.length);
process.exit(pass === cases.length ? 0 : 1);
