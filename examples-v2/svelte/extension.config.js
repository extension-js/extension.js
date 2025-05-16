module.exports = {
  config: (config) => {
    // https://rspack.dev/guide/features/asset-module#supported-asset-module-types
    config.module.rules.push({
      test: /\.ttf$/i,
      type: "asset/inline",
    });

    return config;
  },
};
