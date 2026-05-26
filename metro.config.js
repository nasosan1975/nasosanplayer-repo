const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const shakaStub = path.resolve(__dirname, "stubs/shaka-player.js");

config.resolver = config.resolver ?? {};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "shaka-player" || moduleName.startsWith("shaka-player/")) {
    return { filePath: shakaStub, type: "sourceFile" };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
