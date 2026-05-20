const fs = require('fs');

module.exports = ({ config }) => {
  const raw = process.env.GITHUB_RUN_NUMBER || process.env.BUILD_NUMBER || '';
  const buildNumber = parseInt(raw, 10);
  if (!Number.isNaN(buildNumber) && buildNumber > 0) {
    config.android = { ...(config.android || {}), versionCode: buildNumber };
  }

  const googleServicesFile = process.env.GOOGLE_SERVICES_FILE || './google-services.json';
  if (fs.existsSync(googleServicesFile)) {
    config.android = {
      ...(config.android || {}),
      googleServicesFile,
    };
  }

  return config;
};
