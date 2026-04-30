export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function asNullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

export function getColumn(columns: string[], row: unknown[], name: string): unknown {
  const idx = columns.indexOf(name);
  return idx === -1 ? null : row[idx];
}
