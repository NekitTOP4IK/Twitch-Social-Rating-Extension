const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env = {}) => {
  const isFirefox = !!env.firefox;
  const manifestFile = isFirefox ? 'manifest.firefox.json' : 'manifest.json';

  const isProd = !!env.prod;
  const backendUrl = isProd ? 'https://twitchsocial.qzz.io/api' : 'http://localhost:8000';
  const wsBackendUrl = backendUrl.replace(/^http/, 'ws').replace(/^https/, 'wss');

  return {
    mode: isProd ? 'production' : 'development',
    devtool: isProd ? false : 'cheap-source-map',
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
    plugins: [
      new webpack.DefinePlugin({
        __BACKEND_URL__: JSON.stringify(backendUrl),
        __WS_BACKEND_URL__: JSON.stringify(wsBackendUrl),
        __FRONTEND_URL__: JSON.stringify(isProd ? 'https://twitchsocial.qzz.io' : 'http://localhost:8000'),
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
                .replace(/__WS_BACKEND_URL__/g, wsBackendUrl);
            },
          },
          { from: 'src/popup/popup.html', to: 'popup.html' },
          { from: 'src/background/callback.html', to: 'callback.html' },
          { from: 'icon.png', to: 'icon.png' },
        ],
      }),
    ],
  };
};
