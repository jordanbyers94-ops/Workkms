// Adds the CarPlay "driving task" entitlement and the scene setup CarPlay needs.
// Only switched on when the build has CARPLAY=1 (see app.config.js and eas.json), because
// Apple must approve the entitlement first or the iPhone build can't be signed.
const { withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");

module.exports = function withCarPlay(config) {
  config = withEntitlementsPlist(config, (c) => {
    c.modResults["com.apple.developer.carplay-driving-task"] = true;
    return c;
  });
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: "Phone", UISceneDelegateClassName: "WKPhoneSceneDelegate" },
        ],
        CPTemplateApplicationSceneSessionRoleApplication: [
          { UISceneConfigurationName: "CarPlay", UISceneDelegateClassName: "WKCarPlaySceneDelegate" },
        ],
      },
    };
    return c;
  });
  return config;
};
