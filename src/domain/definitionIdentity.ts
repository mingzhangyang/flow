// Catalog definition 的正式 v1 身份编解码。
// 开放 flowId 永远作为 tuple 数据编码，不参与分隔符命名空间；解析只接受精确 canonical 形态。

export type DefinitionSource = 'owned' | 'example';

export interface DefinitionIdentity {
  source: DefinitionSource;
  flowId: string;
}

const DEFINITION_KEY_VERSION = 'definition-v1';

export function definitionKey(identity: DefinitionIdentity): string {
  if (identity.flowId === '') throw new Error('flowId must not be empty');
  return JSON.stringify([DEFINITION_KEY_VERSION, identity.source, identity.flowId]);
}

export function parseDefinitionKey(value: string): DefinitionIdentity | null {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }

  if (
    !Array.isArray(raw) ||
    raw.length !== 3 ||
    raw[0] !== DEFINITION_KEY_VERSION ||
    (raw[1] !== 'owned' && raw[1] !== 'example') ||
    typeof raw[2] !== 'string' ||
    raw[2] === ''
  ) {
    return null;
  }

  const identity: DefinitionIdentity = {
    source: raw[1],
    flowId: raw[2],
  };
  return definitionKey(identity) === value ? identity : null;
}


export function assertDefinitionKey(value: string): void {
  if (parseDefinitionKey(value) === null) {
    throw new Error('invalid definitionKey');
  }
}


export function parseDefinitionKeyForFlow(
  value: string,
  flowId: string,
): DefinitionIdentity | null {
  const identity = parseDefinitionKey(value);
  return identity !== null && identity.flowId === flowId ? identity : null;
}

export function assertDefinitionKeyForFlow(value: string, flowId: string): DefinitionIdentity {
  const identity = parseDefinitionKeyForFlow(value, flowId);
  if (identity === null) {
    throw new Error('definitionKey does not match flow');
  }
  return identity;
}
