const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env = {}) => {
  const isFirefox = !!env.firefox;
  const manifestFile = isFirefox ? 'manifest.firefox.json' : 'manifest.json';

  const isProd = !!env.prod;

  return {
    mode: isProd ? 'production' : 'development',
    devtool: isProd ? false : 'cheap-source-map',
    entry: {
      content: './src/content/index.ts',
      background: './src/background/service-worker.ts',
      popup: './src/popup/popup.tsx',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
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
      new CopyPlugin({
        patterns: [
          { from: manifestFile, to: 'manifest.json' },
          { from: 'src/popup/popup.html', to: 'popup.html' },
          { from: 'icon.png', to: 'icon.png' },
        ],
      }),
    ],
  };
};
