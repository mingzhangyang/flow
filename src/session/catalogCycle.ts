// Catalog 的持久副作用顺序。
// 未完成 deletion intent 是较早已经提交的业务事实，必须先于任何较新的 mutation 回放；
// mutation 自己若创建了新的 intent，则在投影 snapshot 前再恢复一次。

export async function runCatalogCycle<T>(opts: {
  recover(): Promise<void>;
  mutation?: () => Promise<void>;
  project(): Promise<T>;
}): Promise<T> {
  await opts.recover();
  if (opts.mutation) await opts.mutation();
  await opts.recover();
  return opts.project();
}
