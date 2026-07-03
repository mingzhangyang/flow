// AI 生成的真实端点冒烟：走与应用完全相同的管线
// （buildGenerationRequest → ModelPort 适配器 → parseGeneratedFlow）打一次真实 API。
// CI 不跑（没有也不该有密钥）；发布前或换供应商时用自己的 Key 手动验证连通性：
//
//   AI_API_KEY=sk-... npm run check:ai                          # Anthropic（默认）
//   AI_PROVIDER=openai-compatible AI_BASE_URL=https://api.deepseek.com/v1 \
//     AI_MODEL=deepseek-chat AI_API_KEY=sk-... npm run check:ai # 任意 OpenAI 兼容端点
//
// 可选：AI_PROMPT 换一句描述；AI_LOCALE 换错误文案语言（zh / zh-Hant / en）。

import { createModelPort } from '../src/ai/model/providers.ts';
import { generateFlow } from '../src/ai/generate.ts';
import { localDayIndex } from '../src/runtime/clock.ts';
import { systemTimeZone } from '../src/runtime/systemTimeZone.ts';

const provider = process.env.AI_PROVIDER ?? 'anthropic';
const apiKey = process.env.AI_API_KEY ?? '';
const locale = process.env.AI_LOCALE ?? 'zh';
const prompt =
  process.env.AI_PROMPT ?? '法压咖啡——倒 92 度热水，浸泡 4 分钟，压下压杆再倒出';

let config;
if (provider === 'anthropic') {
  config = { provider, apiKey, model: process.env.AI_MODEL ?? 'claude-opus-4-8' };
} else if (provider === 'openai-compatible') {
  const baseUrl = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL;
  if (!baseUrl || !model) {
    console.error('openai-compatible 需要 AI_BASE_URL 与 AI_MODEL');
    process.exit(2);
  }
  config = { provider, apiKey, baseUrl, model };
} else {
  console.error(`未知 AI_PROVIDER: ${provider}（anthropic | openai-compatible）`);
  process.exit(2);
}
if (!apiKey && provider === 'anthropic') {
  console.error('缺少 AI_API_KEY');
  process.exit(2);
}

const port = createModelPort(config, (url, init) => fetch(url, init), locale);
console.log(`→ ${port.id}`);
console.log(`→ ${prompt}`);

const result = await generateFlow(port, prompt, {
  id: 'smoke',
  locale,
  todayDayIndex: localDayIndex(Date.now(), systemTimeZone),
});

if (!result.ok) {
  console.error(`✗ ${result.error}`);
  process.exit(1);
}
console.log(`✓ 生成并通过校验：《${result.flow.title}》 ${result.flow.nodes.length} 个节点`);
console.log(JSON.stringify(result.flow, null, 2));
