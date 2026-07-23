import type { SessionCacheDiagnostics } from "@opencode-ai/client"
import { Locale } from "./locale"

export function cacheHitPercent(value: SessionCacheDiagnostics["cache"]["hitRatio"]) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : undefined
}

export function formatCacheDiagnostics(diagnostics: SessionCacheDiagnostics) {
  const hitPercent = cacheHitPercent(diagnostics.cache.hitRatio)
  return {
    context:
      diagnostics.context.limit === undefined
        ? `Context ${Locale.number(diagnostics.context.total)} (includes cached)`
        : `Context ${Locale.number(diagnostics.context.total)}/${Locale.number(diagnostics.context.limit)} (${diagnostics.context.percent}%; includes cached)`,
    cache: `Cache hit ${hitPercent === undefined ? "n/a" : `${hitPercent}%`} · ${Locale.number(diagnostics.tokens.cacheRead)} read · ${Locale.number(diagnostics.tokens.cacheWrite)} write · ${Locale.number(diagnostics.tokens.uncachedInput)} uncached`,
  }
}
