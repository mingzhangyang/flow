// Structural equality for JSON-shaped values: key order and `undefined` members ignored.
// Used to tell whether a stored record is exactly the one we meant to write.

export function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]));
  }
  if (
    typeof left !== 'object' || left === null ||
    typeof right !== 'object' || right === null
  ) {
    return false;
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const aKeys = Object.keys(a).filter((key) => a[key] !== undefined).sort();
  const bKeys = Object.keys(b).filter((key) => b[key] !== undefined).sort();
  return aKeys.length === bKeys.length &&
    aKeys.every((key, index) => key === bKeys[index] && sameJsonValue(a[key], b[key]));
}
