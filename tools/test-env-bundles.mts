/**
 * 验证合并写法的环境变量能被正确解析。
 * 运行： npx tsx tools/test-env-bundles.mts
 */
import { parseDatabaseUrl, parseLlmConfig } from '../server/src/config.ts';

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '✓' : '✗') + ' ' + name);
  if (!ok) {
    console.log('   实际: ' + JSON.stringify(got));
    console.log('   期望: ' + JSON.stringify(want));
    failed++;
  }
};

eq(
  '标准连接串',
  parseDatabaseUrl('mysql://alice:s3cret@db.example.com:3311/mydb'),
  { host: 'db.example.com', port: 3311, database: 'mydb', user: 'alice', password: 's3cret', ssl: false },
);

eq(
  '省略端口时默认 3306',
  parseDatabaseUrl('mysql://alice:s3cret@db.example.com/mydb'),
  { host: 'db.example.com', port: 3306, database: 'mydb', user: 'alice', password: 's3cret', ssl: false },
);

eq(
  '密码含特殊字符（需转义）',
  parseDatabaseUrl('mysql://alice:p%40ss%3Aword%2F1@db.example.com:3306/mydb'),
  { host: 'db.example.com', port: 3306, database: 'mydb', user: 'alice', password: 'p@ss:word/1', ssl: false },
);

eq(
  '连接串里的 ?sslmode=require 会开启 TLS',
  parseDatabaseUrl('mysql://u:p@gateway.example.com:4000/test?sslmode=require').ssl,
  true,
);

eq('mysql2:// 前缀也认', parseDatabaseUrl('mysql2://u:p@h:3306/d').host, 'h');
eq('空值返回空对象', parseDatabaseUrl(''), {});
eq('乱填不抛异常', parseDatabaseUrl('这不是连接串'), {});

eq(
  '竖线分隔的模型配置',
  parseLlmConfig('https://api.example.com/v1|sk-abc123|gpt-4o-mini'),
  { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-abc123', model: 'gpt-4o-mini' },
);

eq(
  '带温度的第四段',
  parseLlmConfig('https://api.example.com/v1|sk-abc|m1|0.7'),
  { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-abc', model: 'm1', temperature: 0.7 },
);

eq(
  '带端口的 http 地址不会被拆坏',
  parseLlmConfig('http://1.2.3.4:8317/v1|key|model'),
  { baseUrl: 'http://1.2.3.4:8317/v1', apiKey: 'key', model: 'model' },
);

eq(
  'JSON 写法',
  parseLlmConfig('{"baseUrl":"https://a/v1","apiKey":"k","model":"m"}'),
  { baseUrl: 'https://a/v1', apiKey: 'k', model: 'm' },
);

eq(
  'JSON 下划线键名',
  parseLlmConfig('{"base_url":"https://a/v1","api_key":"k","model":"m"}'),
  { baseUrl: 'https://a/v1', apiKey: 'k', model: 'm' },
);

eq('段数不够时不生效', parseLlmConfig('只有一段'), {});

console.log(failed === 0 ? '\n全部通过' : `\n有 ${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
