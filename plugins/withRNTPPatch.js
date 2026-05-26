const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withRNTPPatch(config) {
  return withDangerousMod(config, [
    "android",
    (config) => {
      const filePath = path.join(
        config.modRequest.projectRoot,
        "node_modules/react-native-track-player/android/src/main/java/com/doublesymmetry/trackplayer/module/MusicModule.kt"
      );

      if (!fs.existsSync(filePath)) {
        console.warn("[withRNTPPatch] MusicModule.kt not found, skipping patch");
        return config;
      }

      let content = fs.readFileSync(filePath, "utf8");
      let changed = 0;

      // Patch 1: tracks[index].originalItem null safety
      const p1 = /Arguments\.fromBundle\(\s*musicService\.tracks\[index\]\.originalItem\s*\)/g;
      if (p1.test(content)) {
        content = content.replace(p1, "Arguments.fromBundle(musicService.tracks[index].originalItem ?: Bundle())");
        changed++;
      }

      // Patch 2: tracks[getCurrentTrackIndex()].originalItem null safety
      const p2 = /Arguments\.fromBundle\(\s*musicService\.tracks\[musicService\.getCurrentTrackIndex\(\)\]\.originalItem\s*\)/g;
      if (p2.test(content)) {
        content = content.replace(p2, "Arguments.fromBundle(musicService.tracks[musicService.getCurrentTrackIndex()].originalItem ?: Bundle())");
        changed++;
      }

      if (changed > 0) {
        fs.writeFileSync(filePath, content);
        console.log(`[withRNTPPatch] Applied ${changed} patch(es) to MusicModule.kt`);
      } else {
        console.warn("[withRNTPPatch] No patches applied — patterns may have changed in this RNTP version");
      }

      return config;
    },
  ]);
}

module.exports = withRNTPPatch;
