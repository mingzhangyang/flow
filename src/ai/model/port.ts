// ModelPort：AI 助手与外部大模型之间的类型化端口（C10 —— 模块只通过接口通信）。
// 设计目标：不绑定任何一家供应商。Claude / OpenAI 兼容端点 / 本地模型都只是本端口的适配器，
// 上层能力（生成等）只依赖本接口，因此更换或新增供应商不触碰业务逻辑。

/** 一次模型调用请求（供应商无关的最小形状）。 */
export interface ModelRequest {
  /** 系统指令：角色设定与输出约束。 */
  system?: string;
  /** 用户输入。 */
  prompt: string;
  /** 输出 token 上限；各适配器负责翻译到自家参数名。 */
  maxTokens?: number;
}

export interface ModelResponse {
  text: string;
  /** 实际响应的模型标识，用于来源标注（E6）。 */
  model: string;
}

export interface ModelPort {
  /** 形如 "anthropic/claude-opus-4-8"，用于展示与 provenance。 */
  readonly id: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

// ---- 适配器共用的最小 HTTP 形状 ----
// fetch 显式注入（与 E3 时钟注入同思路）：契约测试用假 fetch 断言请求形状，
// 应用侧注入平台 fetch。纯逻辑层不引用 DOM 类型。

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

/** 把非 2xx 响应整理成一句可读错误（尽量提取供应商的 error.message）。 */
export function describeHttpError(provider: string, status: number, rawBody: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: string }; message?: string };
    detail = parsed.error?.message ?? parsed.message ?? '';
  } catch {
    detail = rawBody.slice(0, 200);
  }
  return `${provider} 请求失败（HTTP ${status}）${detail ? `：${detail}` : ''}`;
}
