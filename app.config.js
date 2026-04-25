module.exports = ({ config }) => {
  const raw = process.env.GITHUB_RUN_NUMBER || process.env.BUILD_NUMBER || '';
  const buildNumber = parseInt(raw, 10);
  if (!Number.isNaN(buildNumber) && buildNumber > 0) {
    config.android = { ...(config.android || {}), versionCode: buildNumber };
  }
  return config;
};
