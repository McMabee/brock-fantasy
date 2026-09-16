export function firstRelated<T>(relation: T | readonly T[]): T | undefined {
  return Array.isArray(relation) ? (relation as readonly T[])[0] : (relation as T);
}
