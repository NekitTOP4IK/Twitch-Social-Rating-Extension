const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

class StripSourceMappingUrlPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('StripSourceMappingUrlPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'StripSourceMappingUrlPlugin',
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
        },
        (assets) => {
          for (const filename of Object.keys(assets)) {
            if (!filename.endsWith('.js')) continue;
            const source = assets[filename].source().toString();
            const next = source.replace(/^\s*\/\/# sourceMappingURL=.*$/gm, '');
            if (next !== source) {
              compilation.updateAsset(filename, new webpack.sources.RawSource(next));
            }
          }
        },
      );
    });
  }
}

module.exports = (env = {}) => {
  const isFirefox = !!env.firefox;
  const isStore = !!env.store;
  const manifestFile = isFirefox ? 'manifest.firefox.json' : 'manifest.json';

  const isProd = !!env.prod;
  const mode = isProd && !isStore ? 'production' : 'development';
  const backendUrl = isProd ? 'https://twitchsocial.qzz.io/api/v1' : 'http://localhost:8000/api/v1';
  const wsBackendUrl = backendUrl.replace(/^http/, 'ws').replace(/^https/, 'wss');
  const appUrl = isProd ? 'https://twitchsocial.qzz.io' : 'http://localhost:5173';
  const firefoxUpdateUrl = isProd
    ? 'https://twitchsocial.qzz.io/cdn/extensions/firefox/updates.json'
    : 'http://localhost:8000/cdn/extensions/firefox/updates.json';
  // Origin without path — used in CSP connect-src (path-based CSP matching is unreliable in Firefox MV2)
  const backendOrigin = new URL(backendUrl).origin;
  const wsBackendOrigin = backendOrigin.replace(/^http/, 'ws').replace(/^https/, 'wss');

  return {
    mode,
    devtool: isProd || isStore ? false : 'cheap-source-map',
    entry: {
      content: './src/content/index.ts',
      background: isFirefox
        ? './src/background/background-firefox.ts'
        : './src/background/service-worker.ts',
      popup: './src/popup/popup.tsx',
    },
    output: {
      path: path.resolve(__dirname, isFirefox ? 'dist-firefox' : 'dist-chrome'),
      filename: '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    optimization: {
      minimize: false,
    },
    plugins: [
      new webpack.DefinePlugin({
        __BACKEND_URL__: JSON.stringify(backendUrl),
        __WS_BACKEND_URL__: JSON.stringify(wsBackendUrl),
        __FRONTEND_URL__: JSON.stringify(appUrl),
      }),
      new CopyPlugin({
        patterns: [
          {
            from: manifestFile,
            to: 'manifest.json',
            transform(content) {
              return content
                .toString()
                .replace(/__BACKEND_URL__/g, backendUrl)
                .replace(/__WS_BACKEND_URL__/g, wsBackendUrl)
                .replace(/__BACKEND_ORIGIN__/g, backendOrigin)
                .replace(/__WS_BACKEND_ORIGIN__/g, wsBackendOrigin)
                .replace(/__FIREFOX_UPDATE_URL__/g, firefoxUpdateUrl);
            },
          },
          { from: 'src/popup/popup.html', to: 'popup.html' },
          { from: 'src/background/callback.html', to: 'callback.html' },
          { from: 'icon.png', to: 'icon.png' },
        ],
      }),
      new StripSourceMappingUrlPlugin(),
    ],
  };
};
