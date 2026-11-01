export function safeInternalPath(value: string | null | undefined, fallback = "/"): string {
  const path = value || fallback;
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /[\u0000-\u001f]/.test(path)
  ) {
    return fallback;
  }
  return path;
}
