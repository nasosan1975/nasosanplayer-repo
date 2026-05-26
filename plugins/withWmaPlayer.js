// Analyst: NasoSan | Dev: Claude AI
// Licenza: CC BY 4.0 – nasosan.it | https://creativecommons.org/licenses/by/4.0/

const { withAppBuildGradle, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// ── 1. Gradle deps ────────────────────────────────────────────────────────────
var DEPS = [
    '    implementation("androidx.media3:media3-exoplayer:1.4.0")',
    '    implementation("androidx.media3:media3-session:1.4.0")',
    '    implementation("androidx.core:core-ktx:1.15.0")',
    '    implementation("androidx.lifecycle:lifecycle-service:2.8.7")',
    '    implementation("io.github.maitrungduc1410:ffmpeg-kit-min:6.0.1")',
].join("\n");

function withWmaGradleDeps(config) {
    return withAppBuildGradle(config, function(config) {
        if (!config.modResults.contents.includes("ffmpeg-kit-min")) {
            config.modResults.contents = config.modResults.contents.replace(
                /dependencies\s*\{/,
                "dependencies {\n" + DEPS
            );
        }
        if (!config.modResults.contents.includes("libc++_shared.so")) {
            config.modResults.contents = config.modResults.contents.replace(
                /android\s*\{/,
                'android {\n    packagingOptions {\n        pickFirst \'lib/x86/libc++_shared.so\'\n        pickFirst \'lib/x86_64/libc++_shared.so\'\n        pickFirst \'lib/armeabi-v7a/libc++_shared.so\'\n        pickFirst \'lib/arm64-v8a/libc++_shared.so\'\n    }'
            );
        }
        return config;
    });
}

// ── 2. WmaPlayerModule.kt + WmaPlayerPackage.kt ───────────────────────────────
var MODULE_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "import android.net.Uri",
    "import com.arthenica.ffmpegkit.FFmpegKit",
    "import com.arthenica.ffmpegkit.ReturnCode",
    "import com.facebook.react.bridge.Promise",
    "import com.facebook.react.bridge.ReactApplicationContext",
    "import com.facebook.react.bridge.ReactContextBaseJavaModule",
    "import com.facebook.react.bridge.ReactMethod",
    "import java.io.File",
    "import java.io.FileOutputStream",
    "",
    "class WmaPlayerModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {",
    "    override fun getName() = \"WmaPlayer\"",
    "",
    "    @ReactMethod",
    "    fun convertToWav(uri: String, outputPath: String, promise: Promise) {",
    "        Thread {",
    "            val tempWma = File(ctx.cacheDir, \"wma_in_${System.currentTimeMillis()}.wma\")",
    "            val outFile = File(outputPath)",
    "            try {",
    "                // Copia SAF URI in file locale (content:// non cercabile da FFmpeg)",
    "                ctx.contentResolver.openInputStream(Uri.parse(uri))?.use { input ->",
    "                    FileOutputStream(tempWma).use { out -> input.copyTo(out) }",
    "                } ?: throw Exception(\"Cannot open URI: $uri\")",
    "",
    "                outFile.parentFile?.mkdirs()",
    "                outFile.delete()",
    "",
    "                val session = FFmpegKit.execute(",
    "                    \"-i \\\"${tempWma.absolutePath}\\\" -acodec pcm_s16le \\\"${outFile.absolutePath}\\\"\"",
    "                )",
    "                if (!ReturnCode.isSuccess(session.returnCode)) {",
    "                    throw Exception(\"FFmpeg error: ${session.returnCode}\")",
    "                }",
    "                promise.resolve(outputPath)",
    "            } catch (e: Exception) {",
    "                outFile.delete()",
    "                promise.reject(\"WMA_ERROR\", e.message ?: \"Unknown error\")",
    "            } finally {",
    "                tempWma.delete()",
    "            }",
    "        }.start()",
    "    }",
    "}",
    "",
].join("\n");

var PACKAGE_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "import com.facebook.react.ReactPackage",
    "import com.facebook.react.bridge.NativeModule",
    "import com.facebook.react.bridge.ReactApplicationContext",
    "import com.facebook.react.uimanager.ViewManager",
    "",
    "class WmaPlayerPackage : ReactPackage {",
    "    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =",
    "        listOf(WmaPlayerModule(ctx))",
    "    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =",
    "        emptyList()",
    "}",
    "",
].join("\n");

function withWmaKotlinFiles(config) {
    return withDangerousMod(config, ["android", function(config) {
        var dir = path.join(
            config.modRequest.platformProjectRoot,
            "app/src/main/java/com/nasosan/nasosanplayer"
        );
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "WmaPlayerModule.kt"), MODULE_KT, "utf8");
        fs.writeFileSync(path.join(dir, "WmaPlayerPackage.kt"), PACKAGE_KT, "utf8");
        return config;
    }]);
}

// ── 3. Registra WmaPlayerPackage in MainApplication.kt ───────────────────────
function withWmaMainAppPatch(config) {
    return withDangerousMod(config, ["android", function(config) {
        var mainAppPath = path.join(
            config.modRequest.platformProjectRoot,
            "app/src/main/java/com/nasosan/nasosanplayer/MainApplication.kt"
        );
        if (!fs.existsSync(mainAppPath)) return config;
        var src = fs.readFileSync(mainAppPath, "utf8");
        if (!src.includes("WmaPlayerPackage")) {
            if (src.includes("PackageList(this).packages.apply {")) {
                src = src.replace(
                    "PackageList(this).packages.apply {",
                    "PackageList(this).packages.apply {\n            add(WmaPlayerPackage())"
                );
            } else {
                src = src.replace(
                    "val packages = PackageList(this).packages",
                    "val packages = PackageList(this).packages\n                packages.add(WmaPlayerPackage())"
                );
            }
            fs.writeFileSync(mainAppPath, src, "utf8");
        }
        return config;
    }]);
}

module.exports = function withWmaPlayer(config) {
    config = withWmaGradleDeps(config);
    config = withWmaKotlinFiles(config);
    config = withWmaMainAppPatch(config);
    return config;
};
