// Analyst: NasoSan | Dev: Claude AI
// Licenza: CC BY 4.0 – nasosan.it | https://creativecommons.org/licenses/by/4.0/

const { withAndroidManifest, withDangerousMod, withAppBuildGradle } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

var BROWSER_SERVICE = "com.nasosan.nasosanplayer.NasoSanBrowserService";
var MUSIC_SERVICE_RELPATH = "node_modules/react-native-track-player/android/src/main/java/com/doublesymmetry/trackplayer/service/MusicService.kt";

// ── 1. AndroidManifest ────────────────────────────────────────────────────────
function withAutoManifest(config) {
    return withAndroidManifest(config, function(config) {
        var app = config.modResults.manifest.application[0];

        if (!app["meta-data"]) app["meta-data"] = [];
        var hasMeta = app["meta-data"].some(function(m) {
            return m.$["android:name"] === "com.google.android.gms.car.application";
        });
        if (!hasMeta) {
            app["meta-data"].push({
                $: {
                    "android:name": "com.google.android.gms.car.application",
                    "android:resource": "@xml/automotive_app_desc",
                },
            });
        }

        if (!app.service) app.service = [];
        // Rimuove vecchio AutoMediaSessionService se presente
        app.service = app.service.filter(function(s) {
            return s.$["android:name"] !== "com.nasosan.nasosanplayer.AutoMediaSessionService";
        });
        var hasSvc = app.service.some(function(s) {
            return s.$["android:name"] === BROWSER_SERVICE;
        });
        if (!hasSvc) {
            app.service.push({
                $: {
                    "android:name": BROWSER_SERVICE,
                    "android:exported": "true",
                    "android:foregroundServiceType": "mediaPlayback",
                },
                "intent-filter": [
                    {
                        action: [
                            { $: { "android:name": "androidx.media3.session.MediaLibraryService" } },
                            { $: { "android:name": "android.media.browse.MediaBrowserService" } },
                        ],
                    },
                ],
            });
        }

        return config;
    });
}

// ── 2. automotive_app_desc.xml ────────────────────────────────────────────────
function withAutoXml(config) {
    return withDangerousMod(config, [
        "android",
        function(config) {
            var xmlDir = path.join(
                config.modRequest.platformProjectRoot,
                "app/src/main/res/xml"
            );
            fs.mkdirSync(xmlDir, { recursive: true });
            fs.writeFileSync(
                path.join(xmlDir, "automotive_app_desc.xml"),
                '<?xml version="1.0" encoding="utf-8"?>\n<automotiveApp>\n    <uses name="media"/>\n</automotiveApp>\n',
                "utf8"
            );
            return config;
        },
    ]);
}

// ── 3. Gradle deps (self-contained: aggiunge media3 se withWmaPlayer non l'ha ancora fatto) ──
function withAutoGradleDeps(config) {
    return withAppBuildGradle(config, function(config) {
        if (!config.modResults.contents.includes("media3-session")) {
            config.modResults.contents = config.modResults.contents.replace(
                /dependencies\s*\{/,
                'dependencies {\n    implementation("androidx.media3:media3-session:1.4.0")\n    implementation("androidx.media3:media3-exoplayer:1.4.0")'
            );
        }
        return config;
    });
}

// ── 4. Kotlin files ───────────────────────────────────────────────────────────
var NASOSAN_TRACK_CACHE_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "object NasoSanTrackCache {",
    "    @Volatile var currentTitle: String? = null",
    "    @Volatile var currentArtist: String? = null",
    "    @Volatile var queue: List<Pair<String, String>> = emptyList()",
    "}",
    "",
].join("\n");

var TRACK_CACHE_MODULE_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "import com.facebook.react.bridge.ReactApplicationContext",
    "import com.facebook.react.bridge.ReactContextBaseJavaModule",
    "import com.facebook.react.bridge.ReactMethod",
    "",
    "class TrackCacheModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {",
    "    override fun getName() = \"TrackCache\"",
    "",
    "    @ReactMethod",
    "    fun update(title: String, artist: String, queueJson: String) {",
    "        NasoSanTrackCache.currentTitle = title",
    "        NasoSanTrackCache.currentArtist = artist",
    "        try {",
    "            val arr = org.json.JSONArray(queueJson)",
    "            val list = mutableListOf<Pair<String, String>>()",
    "            for (i in 0 until arr.length()) {",
    "                val obj = arr.getJSONObject(i)",
    "                list.add(Pair(obj.optString(\"title\", \"\"), obj.optString(\"artist\", \"\")))",
    "            }",
    "            NasoSanTrackCache.queue = list",
    "        } catch (_: Exception) {}",
    "    }",
    "}",
    "",
].join("\n");

var TRACK_CACHE_PACKAGE_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "import com.facebook.react.ReactPackage",
    "import com.facebook.react.bridge.NativeModule",
    "import com.facebook.react.bridge.ReactApplicationContext",
    "import com.facebook.react.uimanager.ViewManager",
    "",
    "class TrackCachePackage : ReactPackage {",
    "    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =",
    "        listOf(TrackCacheModule(ctx))",
    "    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =",
    "        emptyList()",
    "}",
    "",
].join("\n");

var RNTP_ADAPTER_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "import android.os.Handler",
    "import android.os.Looper",
    "import androidx.media3.common.Player",
    "import androidx.media3.common.util.UnstableApi",
    "import androidx.media3.common.SimpleBasePlayer",
    "import com.doublesymmetry.trackplayer.service.MusicService",
    "import com.google.common.util.concurrent.Futures",
    "import com.google.common.util.concurrent.ListenableFuture",
    "",
    "@OptIn(UnstableApi::class)",
    "class RNTPPlayerAdapter : SimpleBasePlayer(Looper.getMainLooper()) {",
    "    private val rntp: MusicService? get() = MusicService.nasosanInstance",
    "    private val pollHandler = Handler(Looper.getMainLooper())",
    "    private val pollRunnable: Runnable = object : Runnable {",
    "        override fun run() {",
    "            invalidateState()",
    "            pollHandler.postDelayed(this, 500)",
    "        }",
    "    }",
    "",
    "    init { pollHandler.post(pollRunnable) }",
    "",
    "    override fun getState(): State {",
    "        val svc = rntp",
    "        return State.Builder()",
    "            .setAvailableCommands(",
    "                Player.Commands.Builder()",
    "                    .addAll(",
    "                        Player.COMMAND_PLAY_PAUSE,",
    "                        Player.COMMAND_SEEK_TO_NEXT,",
    "                        Player.COMMAND_SEEK_TO_PREVIOUS,",
    "                        Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,",
    "                        Player.COMMAND_GET_CURRENT_MEDIA_ITEM",
    "                    )",
    "                    .build()",
    "            )",
    "            .setPlayWhenReady(",
    "                svc?.playWhenReady ?: false,",
    "                Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST",
    "            )",
    "            .setPlaybackState(if (svc != null) Player.STATE_READY else Player.STATE_IDLE)",
    "            .build()",
    "    }",
    "",
    "    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {",
    "        if (playWhenReady) rntp?.play() else rntp?.pause()",
    "        invalidateState()",
    "        return Futures.immediateVoidFuture()",
    "    }",
    "",
    "    override fun handleSeek(",
    "        mediaItemIndex: Int,",
    "        positionMs: Long,",
    "        seekCommand: Int",
    "    ): ListenableFuture<*> {",
    "        when (seekCommand) {",
    "            Player.COMMAND_SEEK_TO_NEXT,",
    "            Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> rntp?.skipToNext()",
    "            Player.COMMAND_SEEK_TO_PREVIOUS,",
    "            Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> rntp?.skipToPrevious()",
    "            else -> rntp?.seekTo(positionMs.toDouble() / 1000.0)",
    "        }",
    "        invalidateState()",
    "        return Futures.immediateVoidFuture()",
    "    }",
    "",
    "    override fun handleRelease(): ListenableFuture<*> {",
    "        pollHandler.removeCallbacks(pollRunnable)",
    "        return Futures.immediateVoidFuture()",
    "    }",
    "}",
    "",
].join("\n");

var BROWSER_SERVICE_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "import android.app.PendingIntent",
    "import android.content.Intent",
    "import androidx.media3.common.MediaItem",
    "import androidx.media3.common.MediaMetadata",
    "import androidx.media3.common.util.UnstableApi",
    "import androidx.media3.session.LibraryParams",
    "import androidx.media3.session.LibraryResult",
    "import androidx.media3.session.MediaLibraryService",
    "import androidx.media3.session.MediaLibrarySession",
    "import androidx.media3.session.MediaSession",
    "import com.google.common.collect.ImmutableList",
    "import com.google.common.util.concurrent.Futures",
    "import com.google.common.util.concurrent.ListenableFuture",
    "",
    "@OptIn(UnstableApi::class)",
    "class NasoSanBrowserService : MediaLibraryService() {",
    "",
    "    private var session: MediaLibrarySession? = null",
    "    private var adapter: RNTPPlayerAdapter? = null",
    "",
    "    override fun onCreate() {",
    "        super.onCreate()",
    "        val a = RNTPPlayerAdapter()",
    "        adapter = a",
    "        val pi = PendingIntent.getActivity(",
    "            this, 0,",
    "            Intent(this, MainActivity::class.java),",
    "            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE",
    "        )",
    "        session = MediaLibrarySession.Builder(this, a, SessionCallback())",
    "            .setSessionActivity(pi)",
    "            .build()",
    "    }",
    "",
    "    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session",
    "",
    "    override fun onDestroy() {",
    "        session?.release()",
    "        session = null",
    "        adapter?.release()",
    "        adapter = null",
    "        super.onDestroy()",
    "    }",
    "",
    "    inner class SessionCallback : MediaLibrarySession.Callback {",
    "",
    "        override fun onGetLibraryRoot(",
    "            session: MediaLibrarySession,",
    "            browser: MediaSession.ControllerInfo,",
    "            params: LibraryParams?",
    "        ): ListenableFuture<LibraryResult<MediaItem>> {",
    "            val root = MediaItem.Builder()",
    "                .setMediaId(ROOT_ID)",
    "                .setMediaMetadata(",
    "                    MediaMetadata.Builder()",
    "                        .setTitle(\"NasoSan Player\")",
    "                        .setIsBrowsable(true)",
    "                        .setIsPlayable(false)",
    "                        .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)",
    "                        .build()",
    "                )",
    "                .build()",
    "            return Futures.immediateFuture(LibraryResult.ofItem(root, params))",
    "        }",
    "",
    "        override fun onGetChildren(",
    "            session: MediaLibrarySession,",
    "            browser: MediaSession.ControllerInfo,",
    "            parentId: String,",
    "            page: Int,",
    "            pageSize: Int,",
    "            params: LibraryParams?",
    "        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {",
    "            val queue = NasoSanTrackCache.queue",
    "            val items: ImmutableList<MediaItem> = if (queue.isEmpty()) {",
    "                ImmutableList.of(",
    "                    MediaItem.Builder()",
    "                        .setMediaId(\"empty\")",
    "                        .setMediaMetadata(",
    "                            MediaMetadata.Builder()",
    "                                .setTitle(\"Nessuna cassetta caricata\")",
    "                                .setIsPlayable(false)",
    "                                .setIsBrowsable(false)",
    "                                .build()",
    "                        )",
    "                        .build()",
    "                )",
    "            } else {",
    "                ImmutableList.copyOf(queue.mapIndexed { i, t ->",
    "                    MediaItem.Builder()",
    "                        .setMediaId(i.toString())",
    "                        .setMediaMetadata(",
    "                            MediaMetadata.Builder()",
    "                                .setTitle(t.first)",
    "                                .setArtist(t.second)",
    "                                .setIsPlayable(true)",
    "                                .setIsBrowsable(false)",
    "                                .build()",
    "                        )",
    "                        .build()",
    "                })",
    "            }",
    "            return Futures.immediateFuture(LibraryResult.ofItemList(items, params))",
    "        }",
    "    }",
    "",
    "    companion object {",
    "        private const val ROOT_ID = \"__nasosan_root__\"",
    "    }",
    "}",
    "",
].join("\n");

function withAutoKotlinFiles(config) {
    return withDangerousMod(config, [
        "android",
        function(config) {
            var javaDir = path.join(
                config.modRequest.platformProjectRoot,
                "app/src/main/java/com/nasosan/nasosanplayer"
            );
            fs.mkdirSync(javaDir, { recursive: true });
            // Rimuove vecchio AutoMediaSessionService se presente
            var oldSvc = path.join(javaDir, "AutoMediaSessionService.kt");
            if (fs.existsSync(oldSvc)) fs.unlinkSync(oldSvc);
            fs.writeFileSync(path.join(javaDir, "NasoSanTrackCache.kt"), NASOSAN_TRACK_CACHE_KT, "utf8");
            fs.writeFileSync(path.join(javaDir, "TrackCacheModule.kt"), TRACK_CACHE_MODULE_KT, "utf8");
            fs.writeFileSync(path.join(javaDir, "TrackCachePackage.kt"), TRACK_CACHE_PACKAGE_KT, "utf8");
            fs.writeFileSync(path.join(javaDir, "RNTPPlayerAdapter.kt"), RNTP_ADAPTER_KT, "utf8");
            fs.writeFileSync(path.join(javaDir, "NasoSanBrowserService.kt"), BROWSER_SERVICE_KT, "utf8");
            return config;
        },
    ]);
}

// ── 5. Patch MusicService.kt: nasosanInstance statico ────────────────────────
function withMusicServicePatch(config) {
    return withDangerousMod(config, [
        "android",
        function(config) {
            var svcPath = path.join(
                config.modRequest.projectRoot,
                MUSIC_SERVICE_RELPATH
            );
            if (!fs.existsSync(svcPath)) return config;

            var src = fs.readFileSync(svcPath, "utf8");
            if (src.includes("nasosanInstance")) return config;

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

            fs.writeFileSync(svcPath, src, "utf8");
            return config;
        },
    ]);
}

// ── 6. Registra TrackCachePackage in MainApplication ─────────────────────────
function withTrackCacheMainAppPatch(config) {
    return withDangerousMod(config, ["android", function(config) {
        var mainAppPath = path.join(
            config.modRequest.platformProjectRoot,
            "app/src/main/java/com/nasosan/nasosanplayer/MainApplication.kt"
        );
        if (!fs.existsSync(mainAppPath)) return config;
        var src = fs.readFileSync(mainAppPath, "utf8");
        if (!src.includes("TrackCachePackage")) {
            if (src.includes("PackageList(this).packages.apply {")) {
                src = src.replace(
                    "PackageList(this).packages.apply {",
                    "PackageList(this).packages.apply {\n            add(TrackCachePackage())"
                );
            } else {
                src = src.replace(
                    "val packages = PackageList(this).packages",
                    "val packages = PackageList(this).packages\n                packages.add(TrackCachePackage())"
                );
            }
            fs.writeFileSync(mainAppPath, src, "utf8");
        }
        return config;
    }]);
}

module.exports = function withAndroidAuto(config) {
    config = withAutoManifest(config);
    config = withAutoXml(config);
    config = withAutoGradleDeps(config);
    config = withAutoKotlinFiles(config);
    config = withMusicServicePatch(config);
    config = withTrackCacheMainAppPatch(config);
    return config;
};
