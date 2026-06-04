// Analyst: NasoSan | Dev: Claude AI
// Licenza: CC BY 4.0 – nasosan.it | https://creativecommons.org/licenses/by/4.0/

const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

var MUSIC_SERVICE_RELPATH = "node_modules/react-native-track-player/android/src/main/java/com/doublesymmetry/trackplayer/service/MusicService.kt";

var MODULE_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "import android.media.MediaCodec",
    "import android.media.MediaExtractor",
    "import android.media.MediaFormat",
    "import android.media.audiofx.LoudnessEnhancer",
    "import android.net.Uri",
    "import androidx.annotation.OptIn",
    "import androidx.media3.common.util.UnstableApi",
    "import com.facebook.react.bridge.Promise",
    "import com.facebook.react.bridge.ReactApplicationContext",
    "import com.facebook.react.bridge.ReactContextBaseJavaModule",
    "import com.facebook.react.bridge.ReactMethod",
    "import android.os.Handler",
    "import android.os.Looper",
    "import kotlin.math.log10",
    "import kotlin.math.sqrt",
    "",
    "class VolumeAnalyzerModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {",
    "    override fun getName() = \"VolumeAnalyzer\"",
    "",
    "    @Volatile private var cancelled = false",
    "    private var loudnessEnhancer: LoudnessEnhancer? = null",
    "    private var enhancerSessionId: Int = 0",
    "    private val mainHandler = Handler(Looper.getMainLooper())",
    "",
    "    @ReactMethod",
    "    fun analyzeRMS(uri: String, promise: Promise) {",
    "        Thread {",
    "            cancelled = false",
    "            val extractor = MediaExtractor()",
    "            var codec: MediaCodec? = null",
    "            try {",
    "                extractor.setDataSource(ctx, Uri.parse(uri), null)",
    "                val trackIdx = (0 until extractor.trackCount).firstOrNull {",
    "                    extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)",
    "                        ?.startsWith(\"audio/\") == true",
    "                }",
    "                if (trackIdx == null) {",
    "                    promise.resolve(-60.0)",
    "                    return@Thread",
    "                }",
    "                extractor.selectTrack(trackIdx)",
    "                val format = extractor.getTrackFormat(trackIdx)",
    "                codec = MediaCodec.createDecoderByType(",
    "                    format.getString(MediaFormat.KEY_MIME)!!",
    "                )",
    "                codec.configure(format, null, null, 0)",
    "                codec.start()",
    "",
    "                val duration = try { format.getLong(MediaFormat.KEY_DURATION) } catch (_: Exception) { 0L }",
    "                val sampleRate = try { format.getInteger(MediaFormat.KEY_SAMPLE_RATE) } catch (_: Exception) { 44100 }",
    "                val channels = try { format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) } catch (_: Exception) { 2 }",
    "                val windowSamples = 5L * sampleRate * channels",
    "",
    "                var sumSq = 0.0",
    "                var n = 0L",
    "                val info = MediaCodec.BufferInfo()",
    "",
    "                val seekPoints = if (duration > 30_000_000L) listOf(30_000_000L, 0L) else listOf(0L)",
    "",
    "                for (seekPos in seekPoints) {",
    "                    if (cancelled) break",
    "                    extractor.seekTo(seekPos, MediaExtractor.SEEK_TO_CLOSEST_SYNC)",
    "                    codec.flush()",
    "                    var windowN = 0L",
    "                    var inputDone = false",
    "                    var outputDone = false",
    "                    while (!outputDone && windowN < windowSamples && !cancelled) {",
    "                        if (!inputDone) {",
    "                            val idx = codec.dequeueInputBuffer(5000)",
    "                            if (idx >= 0) {",
    "                                val buf = codec.getInputBuffer(idx)!!",
    "                                val sz = extractor.readSampleData(buf, 0)",
    "                                if (sz < 0) {",
    "                                    codec.queueInputBuffer(idx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)",
    "                                    inputDone = true",
    "                                } else {",
    "                                    codec.queueInputBuffer(idx, 0, sz, extractor.sampleTime, 0)",
    "                                    extractor.advance()",
    "                                }",
    "                            }",
    "                        }",
    "                        val outIdx = codec.dequeueOutputBuffer(info, 5000)",
    "                        if (outIdx >= 0) {",
    "                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {",
    "                                outputDone = true",
    "                            } else if (info.size > 0) {",
    "                                val buf = codec.getOutputBuffer(outIdx)!!",
    "                                val shorts = buf.asShortBuffer()",
    "                                while (shorts.hasRemaining()) {",
    "                                    val s = shorts.get().toDouble() / 32768.0",
    "                                    if (kotlin.math.abs(s) > 0.001) { sumSq += s * s; n++ }",
    "                                    windowN++",
    "                                }",
    "                            }",
    "                            codec.releaseOutputBuffer(outIdx, false)",
    "                        }",
    "                    }",
    "                    if (n > 0) break",
    "                }",
    "",
    "                val rms = if (n > 0) sqrt(sumSq / n) else 1e-6",
    "                promise.resolve(20.0 * log10(rms.coerceAtLeast(1e-6)))",
    "            } catch (e: Exception) {",
    "                promise.reject(\"ANALYZE_ERROR\", e.message ?: \"Unknown\")",
    "            } finally {",
    "                try { codec?.stop() } catch (_: Exception) {}",
    "                try { codec?.release() } catch (_: Exception) {}",
    "                extractor.release()",
    "            }",
    "        }.start()",
    "    }",
    "",
    "    @ReactMethod",
    "    fun cancelAnalysis() {",
    "        cancelled = true",
    "    }",
    "",
    "    @ReactMethod",
    "    @OptIn(UnstableApi::class)",
    "    fun applyGain(gainDb: Float, promise: Promise) {",
    "        promise.resolve(null)",
    "        applyGainInternal(gainDb, 3)",
    "    }",
    "",
    "    @OptIn(UnstableApi::class)",
    "    private fun applyGainInternal(gainDb: Float, retries: Int) {",
    "        mainHandler.post {",
    "            try {",
    "                if (gainDb <= 0.1f) {",
    "                    loudnessEnhancer?.enabled = false",
    "                    return@post",
    "                }",
    "                val sessionId = try {",
    "                    NasoSanPlaybackService.instance?.player?.audioSessionId ?: 0",
    "                } catch (_: Exception) { 0 }",
    "                if (sessionId == 0) {",
    "                    if (retries > 0) mainHandler.postDelayed({ applyGainInternal(gainDb, retries - 1) }, 500)",
    "                    return@post",
    "                }",
    "                if (loudnessEnhancer == null || enhancerSessionId != sessionId) {",
    "                    try { loudnessEnhancer?.release() } catch (_: Exception) {}",
    "                    loudnessEnhancer = LoudnessEnhancer(sessionId)",
    "                    enhancerSessionId = sessionId",
    "                }",
    "                loudnessEnhancer!!.setTargetGain((gainDb * 100).toInt().coerceIn(0, 2000))",
    "                loudnessEnhancer!!.enabled = true",
    "            } catch (_: Exception) {}",
    "        }",
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
    "class VolumeAnalyzerPackage : ReactPackage {",
    "    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =",
    "        listOf(VolumeAnalyzerModule(ctx))",
    "    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =",
    "        emptyList()",
    "}",
    "",
].join("\n");

function withVolumeAnalyzerKotlin(config) {
    return withDangerousMod(config, ["android", function(config) {
        var dir = path.join(
            config.modRequest.platformProjectRoot,
            "app/src/main/java/com/nasosan/nasosanplayer"
        );
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "VolumeAnalyzerModule.kt"), MODULE_KT, "utf8");
        fs.writeFileSync(path.join(dir, "VolumeAnalyzerPackage.kt"), PACKAGE_KT, "utf8");
        return config;
    }]);
}

function withVolumeAnalyzerMusicServicePatch(config) {
    return withDangerousMod(config, ["android", function(config) {
        var svcPath = path.join(config.modRequest.projectRoot, MUSIC_SERVICE_RELPATH);
        if (!fs.existsSync(svcPath)) return config;
        var src = fs.readFileSync(svcPath, "utf8");

        if (!src.includes("nasosanInstance")) {
            src = src.replace(
                "    companion object {",
                "    companion object {\n        @JvmStatic var nasosanInstance: MusicService? = null"
            );
            src = src.replace(
                "    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {\n        startTask",
                "    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {\n        nasosanInstance = this\n        startTask"
            );
            src = src.replace(
                "    @MainThread\n    override fun onDestroy() {\n        super.onDestroy()",
                "    @MainThread\n    override fun onDestroy() {\n        nasosanInstance = null\n        super.onDestroy()"
            );
        }

        if (!src.includes("nasosanAudioSessionId")) {
            src = src.replace(
                "            player.playWhenReady = value\n        }",
                "            player.playWhenReady = value\n        }\n\n    val nasosanAudioSessionId: Int\n        get() = try {\n            var cls: Class<*>? = player.javaClass\n            var sid = 0\n            while (cls != null && sid == 0) {\n                val f = cls.declaredFields.firstOrNull { it.name == \"exoPlayer\" }\n                if (f != null) { f.isAccessible = true; sid = f.get(player)?.let { ep -> ep.javaClass.getMethod(\"getAudioSessionId\").invoke(ep) as? Int } ?: 0 }\n                cls = cls.superclass\n            }\n            sid\n        } catch (e: Exception) { 0 }"
            );
        }

        fs.writeFileSync(svcPath, src, "utf8");
        return config;
    }]);
}

function withVolumeAnalyzerMainAppPatch(config) {
    return withDangerousMod(config, ["android", function(config) {
        var mainAppPath = path.join(
            config.modRequest.platformProjectRoot,
            "app/src/main/java/com/nasosan/nasosanplayer/MainApplication.kt"
        );
        if (!fs.existsSync(mainAppPath)) return config;
        var src = fs.readFileSync(mainAppPath, "utf8");
        if (!src.includes("VolumeAnalyzerPackage")) {
            if (src.includes("PackageList(this).packages.apply {")) {
                src = src.replace(
                    "PackageList(this).packages.apply {",
                    "PackageList(this).packages.apply {\n            add(VolumeAnalyzerPackage())"
                );
            } else {
                src = src.replace(
                    "val packages = PackageList(this).packages",
                    "val packages = PackageList(this).packages\n                packages.add(VolumeAnalyzerPackage())"
                );
            }
            fs.writeFileSync(mainAppPath, src, "utf8");
        }
        return config;
    }]);
}

module.exports = function withVolumeAnalyzer(config) {
    config = withVolumeAnalyzerKotlin(config);
    config = withVolumeAnalyzerMusicServicePatch(config);
    config = withVolumeAnalyzerMainAppPatch(config);
    return config;
};
