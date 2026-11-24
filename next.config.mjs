/**
 * AzusaTrade - PineTS 0.13.1 browser bundling workaround.
 *
 * In a Node.js diagnostic, PINETS_DISABLE_LTF_SLICING=1 allows the unchanged
 * 180-candle GoldGuard to finish rather than failing in request.security().
 * The same runtime environment variable is not reliable after webpack bundles
 * the browser Worker. Next.js `env` embeds its value into the CLIENT bundle.
 *
 * This disables slicing in the bundled PineTS runtime generally, which may
 * make other complex scripts slower. It changes no Pine trading rules and
 * must not be treated as proof that output matches TradingView.
 */
const config = {
  poweredByHeader: false,
  env: {
    PINETS_DISABLE_LTF_SLICING: "1",
  },
  outputFileTracingIncludes: { "/api/goldguard": ["./indicators/GoldGuard.pine"] },
  experimental: { cpus: 2 },
  webpack(webpackConfig) {
    webpackConfig.module.rules.push({ test: /\.worker\.mjs$/, type: "javascript/auto" });
    return webpackConfig;
  },
};
export default config;
