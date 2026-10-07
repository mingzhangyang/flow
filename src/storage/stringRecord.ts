// 开放 Flow ID 可为任意非空字符串，包括 "__proto__"。
// 对普通对象使用 record[key] = value 会触发 Object.prototype.__proto__ setter。
// 统一用 DefineProperty 创建真正的 own data property，保持备份 JSON schema 不变且避免原型语义。

export function setStringRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
