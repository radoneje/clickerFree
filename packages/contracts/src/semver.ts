// Простое сравнение версий вида major.minor.patch; неизвестные части считаются нулём.
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function isVersionSupported(appVersion: string, minSupportedVersion: string): boolean {
  return compareSemver(appVersion, minSupportedVersion) >= 0;
}
