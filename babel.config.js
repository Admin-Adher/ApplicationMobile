module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      '@babel/plugin-transform-class-static-block',
      // Replace import.meta which Hermes (Android JS engine) does not support.
      // pdfjs-dist v5 uses import.meta.url for worker loading; stubbing it to
      // a plain object keeps the bundle valid — workers are not used in RN anyway.
      function importMetaStubPlugin({ types: t }) {
        return {
          visitor: {
            MetaProperty(path) {
              if (
                path.node.meta.name === 'import' &&
                path.node.property.name === 'meta'
              ) {
                path.replaceWith(
                  t.objectExpression([
                    t.objectProperty(
                      t.identifier('url'),
                      t.stringLiteral('file:///index.js')
                    ),
                    t.objectProperty(
                      t.identifier('env'),
                      t.objectExpression([])
                    ),
                  ])
                );
              }
            },
          },
        };
      },
    ],
  };
};
