// Env reads where an empty value must mean "not configured".
//
// `process.env.X ?? fallback` only falls back when X is absent. A key that is present
// but empty (`CLINIC_NAME=` in a .env file, or a blank value in the Vercel dashboard)
// yields "" and silently bypasses the fallback — which produced "Welcome to  " and an
// empty booking-link message. Route such reads through envOrUndefined() instead.

/**
 * Returns process.env[name] unchanged when it holds any non-whitespace character;
 * undefined when it is absent, empty, or whitespace-only. A configured value is NOT
 * trimmed, so behaviour for real values is identical to a plain process.env read.
 */
export function envOrUndefined(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "" ? value : undefined;
}
