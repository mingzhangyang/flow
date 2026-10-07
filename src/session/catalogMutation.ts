// Catalog mutation 与派生同步结果必须分开表达。
//
// 业务 mutation（保存/导入/恢复）一旦成功，就不能因为随后 reminder reschedule / catalog reload
// 失败而向 UI 假装“保存失败”，否则用户重试会制造重复修订。反之 mutation 本身失败时，
// 仍让 refresh pipeline 收口到当前真实 snapshot，再把原始 mutation error 返回给 UI。

export async function runCommittedCatalogMutation<T>(
  refresh: (mutation: () => Promise<void>) => Promise<void>,
  mutation: () => Promise<T>,
): Promise<T> {
  let mutationCompleted = false;
  let mutationFailed = false;
  let mutationError: unknown;
  let result!: T;

  try {
    await refresh(async () => {
      try {
        result = await mutation();
        mutationCompleted = true;
      } catch (error) {
        mutationFailed = true;
        mutationError = error;
      }
    });
  } catch (syncError) {
    if (mutationFailed) throw mutationError;
    if (mutationCompleted) return result;
    throw syncError;
  }

  if (mutationFailed) throw mutationError;
  if (!mutationCompleted) throw new Error('catalog mutation was not executed');
  return result;
}
