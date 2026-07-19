export function suggestConnectionName(baseName: string, existingNames: readonly string[]): string {
  const base = baseName.trim();
  const occupied = new Set(existingNames.map(normalizeConnectionName));
  if (!occupied.has(normalizeConnectionName(base))) return base;

  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!occupied.has(normalizeConnectionName(candidate))) return candidate;
  }
}

function normalizeConnectionName(value: string): string {
  return value.trim().toLocaleLowerCase();
}
