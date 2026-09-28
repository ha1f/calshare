// e2e の基準時刻（docs/design.md §10.3）。ブラウザ側は fixtures.ts が page.clock で、
// Worker 側は playwright.config.ts の webServer が wrangler dev の --var で、同じ値に固定する
export const E2E_FIXED_NOW = new Date('2026-09-16T01:00:00Z')
