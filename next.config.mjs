const config = {
  poweredByHeader: false,
  outputFileTracingIncludes: { "/api/goldguard": ["./indicators/GoldGuard.pine"] },
  experimental: { cpus: 2 },
  webpack(webpackConfig) {
    webpackConfig.module.rules.push({ test: /\.worker\.mjs$/, type: "javascript/auto" });
    return webpackConfig;
  },
};
export default config;
