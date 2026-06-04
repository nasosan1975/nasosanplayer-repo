// Analyst: NasoSan | Dev: Claude AI
// Licenza: CC BY 4.0 – nasosan.it | https://creativecommons.org/licenses/by/4.0/

const { withAndroidManifest, withDangerousMod, withAppBuildGradle } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

var BROWSER_SERVICE = "com.nasosan.nasosanplayer.NasoSanBrowserService";

// ── 1. AndroidManifest ────────────────────────────────────────────────────────
function withAutoManifest(config) {
    return withAndroidManifest(config, function(config) {
        var app = config.modResults.manifest.application[0];

        if (!app["meta-data"]) app["meta-data"] = [];
        var hasMeta = app["meta-data"].some(function(m) {
            return m.$ && m.$["android:name"] === "com.google.android.gms.car.application";
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
        // Rimuove entry vecchie (sia old name che current) e aggiunge sempre la versione aggiornata
        app.service = app.service.filter(function(s) {
            if (!s.$) return true;
            var n = s.$["android:name"];
            return n !== BROWSER_SERVICE && n !== "com.nasosan.nasosanplayer.AutoMediaSessionService";
        });
        app.service.push({
            $: {
                "android:name": BROWSER_SERVICE,
                "android:exported": "true",
                "android:permission": "android.permission.BIND_MEDIA_BROWSER_SERVICE",
            },
            "intent-filter": [
                {
                    action: [
                        { $: { "android:name": "android.media.browse.MediaBrowserService" } },
                    ],
                },
            ],
        });

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

// ── 3. Gradle deps (androidx.media:media per MediaBrowserServiceCompat) ──────
function withAutoGradleDeps(config) {
    return withAppBuildGradle(config, function(config) {
        var contents = config.modResults.contents;
        if (!contents.includes('implementation("androidx.media:media:')) {
            contents = contents.replace(
                /dependencies\s*\{/,
                'dependencies {\n    implementation("androidx.media:media:1.7.0")'
            );
        }
        config.modResults.contents = contents;
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

var BROWSER_SERVICE_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "import android.app.PendingIntent",
    "import android.content.ComponentName",
    "import android.content.Context",
    "import android.content.Intent",
    "import android.content.ServiceConnection",
    "import android.os.Bundle",
    "import android.os.Handler",
    "import android.os.IBinder",
    "import android.os.Looper",
    "import android.support.v4.media.MediaBrowserCompat",
    "import android.support.v4.media.MediaDescriptionCompat",
    "import android.support.v4.media.MediaMetadataCompat",
    "import android.support.v4.media.session.MediaSessionCompat",
    "import android.support.v4.media.session.PlaybackStateCompat",
    "import androidx.media.MediaBrowserServiceCompat",
    "import com.doublesymmetry.trackplayer.service.MusicService",
    "",
    "class NasoSanBrowserService : MediaBrowserServiceCompat() {",
    "",
    "    private var mediaSession: MediaSessionCompat? = null",
    "    private var musicService: MusicService? = null",
    "    private var isBound = false",
    "    private val mainHandler = Handler(Looper.getMainLooper())",
    "    private var lastQueueSnapshot: List<Pair<String, String>> = emptyList()",
    "    private var pendingAction: (() -> Unit)? = null",
    "",
    "    private val serviceConnection = object : ServiceConnection {",
    "        override fun onServiceConnected(name: ComponentName, binder: IBinder) {",
    "            musicService = (binder as? MusicService.MusicBinder)?.service",
    "            pendingAction?.invoke()",
    "            pendingAction = null",
    "        }",
    "        override fun onServiceDisconnected(name: ComponentName) {",
    "            musicService = null",
    "            isBound = false",
    "            mainHandler.postDelayed({ tryBindMusicService() }, 3000)",
    "        }",
    "    }",
    "",
    "    private fun tryBindMusicService() {",
    "        if (isBound) return",
    "        try {",
    "            isBound = bindService(",
    "                Intent(this, MusicService::class.java),",
    "                serviceConnection,",
    "                Context.BIND_AUTO_CREATE",
    "            )",
    "        } catch (_: Exception) { isBound = false }",
    "    }",
    "",
    "    private fun executeOrQueue(action: () -> Unit) {",
    "        val svc = musicService",
    "        if (svc != null) {",
    "            try { action() } catch (_: Exception) {}",
    "        } else {",
    "            pendingAction = action",
    "            tryBindMusicService()",
    "        }",
    "    }",
    "",
    "    private fun buildState(state: Int): PlaybackStateCompat =",
    "        PlaybackStateCompat.Builder()",
    "            .setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1.0f)",
    "            .setActions(",
    "                PlaybackStateCompat.ACTION_PLAY or",
    "                PlaybackStateCompat.ACTION_PAUSE or",
    "                PlaybackStateCompat.ACTION_PLAY_PAUSE or",
    "                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or",
    "                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or",
    "                PlaybackStateCompat.ACTION_SEEK_TO or",
    "                PlaybackStateCompat.ACTION_SKIP_TO_QUEUE_ITEM or",
    "                PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID",
    "            )",
    "            .build()",
    "",
    "    private fun syncState() {",
    "        try {",
    "            val svc = musicService",
    "            val playing = svc != null && try { svc.playWhenReady } catch (_: Exception) { false }",
    "            val state = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED",
    "            mediaSession?.setPlaybackState(buildState(state))",
    "            val title = NasoSanTrackCache.currentTitle ?: \"\"",
    "            val artist = NasoSanTrackCache.currentArtist ?: \"\"",
    "            if (title.isNotEmpty()) {",
    "                val queue = NasoSanTrackCache.queue",
    "                val idx = queue.indexOfFirst { it.first == title }",
    "                val mediaId = if (idx >= 0) idx.toString() else \"0\"",
    "                mediaSession?.setMetadata(",
    "                    MediaMetadataCompat.Builder()",
    "                        .putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, mediaId)",
    "                        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)",
    "                        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)",
    "                        .build()",
    "                )",
    "            }",
    "            val currentQueue = NasoSanTrackCache.queue",
    "            if (currentQueue !== lastQueueSnapshot) {",
    "                lastQueueSnapshot = currentQueue",
    "                notifyChildrenChanged(ROOT_ID)",
    "            }",
    "        } catch (_: Exception) {}",
    "        mainHandler.postDelayed({ syncState() }, 1000)",
    "    }",
    "",
    "    override fun onCreate() {",
    "        super.onCreate()",
    "        val pi = PendingIntent.getActivity(",
    "            this, 0,",
    "            Intent(this, MainActivity::class.java),",
    "            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE",
    "        )",
    "        mediaSession = MediaSessionCompat(this, \"NasoSanPlayer\").also { session ->",
    "            session.setSessionActivity(pi)",
    "            session.setCallback(object : MediaSessionCompat.Callback() {",
    "                override fun onPlay() {",
    "                    executeOrQueue {",
    "                        musicService?.play()",
    "                        mediaSession?.setPlaybackState(buildState(PlaybackStateCompat.STATE_PLAYING))",
    "                    }",
    "                }",
    "                override fun onPause() {",
    "                    executeOrQueue {",
    "                        musicService?.pause()",
    "                        mediaSession?.setPlaybackState(buildState(PlaybackStateCompat.STATE_PAUSED))",
    "                    }",
    "                }",
    "                override fun onSkipToNext() {",
    "                    executeOrQueue { musicService?.skipToNext() }",
    "                }",
    "                override fun onSkipToPrevious() {",
    "                    executeOrQueue { musicService?.skipToPrevious() }",
    "                }",
    "                override fun onSkipToQueueItem(id: Long) {",
    "                    executeOrQueue { musicService?.skip(id.toInt()) }",
    "                }",
    "                override fun onSeekTo(pos: Long) {",
    "                    executeOrQueue { musicService?.seekTo((pos / 1000.0).toFloat()) }",
    "                }",
    "                override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {",
    "                    val index = mediaId?.toIntOrNull() ?: return",
    "                    executeOrQueue {",
    "                        musicService?.skip(index)",
    "                        musicService?.play()",
    "                        mediaSession?.setPlaybackState(buildState(PlaybackStateCompat.STATE_PLAYING))",
    "                    }",
    "                }",
    "            }, mainHandler)",
    "            session.setPlaybackState(buildState(PlaybackStateCompat.STATE_PAUSED))",
    "            session.isActive = true",
    "            setSessionToken(session.sessionToken)",
    "        }",
    "        tryBindMusicService()",
    "        syncState()",
    "    }",
    "",
    "    override fun onGetRoot(",
    "        clientPackageName: String,",
    "        clientUid: Int,",
    "        rootHints: Bundle?",
    "    ): BrowserRoot = BrowserRoot(ROOT_ID, null)",
    "",
    "    override fun onLoadChildren(",
    "        parentId: String,",
    "        result: Result<List<MediaBrowserCompat.MediaItem>>",
    "    ) {",
    "        if (parentId != ROOT_ID) {",
    "            result.sendResult(emptyList())",
    "            return",
    "        }",
    "        val queue = NasoSanTrackCache.queue",
    "        if (queue.isEmpty()) {",
    "            result.sendResult(listOf(",
    "                MediaBrowserCompat.MediaItem(",
    "                    MediaDescriptionCompat.Builder()",
    "                        .setMediaId(\"empty\")",
    "                        .setTitle(\"Nessuna cassetta caricata\")",
    "                        .build(),",
    "                    MediaBrowserCompat.MediaItem.FLAG_PLAYABLE",
    "                )",
    "            ))",
    "            return",
    "        }",
    "        result.sendResult(queue.mapIndexed { i, t ->",
    "            MediaBrowserCompat.MediaItem(",
    "                MediaDescriptionCompat.Builder()",
    "                    .setMediaId(i.toString())",
    "                    .setTitle(t.first)",
    "                    .setSubtitle(t.second)",
    "                    .build(),",
    "                MediaBrowserCompat.MediaItem.FLAG_PLAYABLE",
    "            )",
    "        })",
    "    }",
    "",
    "    override fun onDestroy() {",
    "        mainHandler.removeCallbacksAndMessages(null)",
    "        if (isBound) {",
    "            try { unbindService(serviceConnection) } catch (_: Exception) {}",
    "            isBound = false",
    "        }",
    "        mediaSession?.release()",
    "        mediaSession = null",
    "        super.onDestroy()",
    "    }",
    "",
    "    companion object {",
    "        private const val ROOT_ID = \"__nasosan_root__\"",
    "    }",
    "}",
    "",
].join("\n");

var CAR_MODE_MODULE_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "import android.content.BroadcastReceiver",
    "import android.content.Context",
    "import android.content.Intent",
    "import android.content.IntentFilter",
    "import android.os.BatteryManager",
    "import android.os.Build",
    "import com.facebook.react.bridge.Promise",
    "import com.facebook.react.bridge.ReactApplicationContext",
    "import com.facebook.react.bridge.ReactContextBaseJavaModule",
    "import com.facebook.react.bridge.ReactMethod",
    "import com.facebook.react.modules.core.DeviceEventManagerModule",
    "",
    "class CarModeModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {",
    "",
    "    override fun getName() = \"CarModeModule\"",
    "",
    "    private fun isCableConnected(): Boolean {",
    "        val intent = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))",
    "        val plugged = intent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0",
    "        return plugged != 0",
    "    }",
    "",
    "    private val receiver = object : BroadcastReceiver() {",
    "        override fun onReceive(context: Context, intent: Intent) {",
    "            val emitter = ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)",
    "                ?: return",
    "            when (intent.action) {",
    "                Intent.ACTION_POWER_CONNECTED  -> emitter.emit(\"nasosan_car_enter\", null)",
    "                Intent.ACTION_POWER_DISCONNECTED -> emitter.emit(\"nasosan_car_exit\", null)",
    "            }",
    "        }",
    "    }",
    "",
    "    private var listening = false",
    "",
    "    @ReactMethod",
    "    fun startListening() {",
    "        if (listening) return",
    "        val filter = IntentFilter().apply {",
    "            addAction(Intent.ACTION_POWER_CONNECTED)",
    "            addAction(Intent.ACTION_POWER_DISCONNECTED)",
    "        }",
    "        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {",
    "            ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)",
    "        } else {",
    "            ctx.registerReceiver(receiver, filter)",
    "        }",
    "        listening = true",
    "    }",
    "",
    "    @ReactMethod",
    "    fun stopListening() {",
    "        if (!listening) return",
    "        try { ctx.unregisterReceiver(receiver) } catch (_: Exception) {}",
    "        listening = false",
    "    }",
    "",
    "    @ReactMethod",
    "    fun isInCarMode(promise: Promise) {",
    "        promise.resolve(isCableConnected())",
    "    }",
    "}",
    "",
].join("\n");

var CAR_MODE_PACKAGE_KT = [
    "package com.nasosan.nasosanplayer",
    "",
    "import com.facebook.react.ReactPackage",
    "import com.facebook.react.bridge.NativeModule",
    "import com.facebook.react.bridge.ReactApplicationContext",
    "import com.facebook.react.uimanager.ViewManager",
    "",
    "class CarModePackage : ReactPackage {",
    "    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =",
    "        listOf(CarModeModule(ctx))",
    "    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =",
    "        emptyList()",
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
            // Rimuove file legacy
            var oldFiles = ["AutoMediaSessionService.kt", "RNTPPlayerAdapter.kt"];
            oldFiles.forEach(function(f) {
                var p = path.join(javaDir, f);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            });
            fs.writeFileSync(path.join(javaDir, "NasoSanTrackCache.kt"), NASOSAN_TRACK_CACHE_KT, "utf8");
            fs.writeFileSync(path.join(javaDir, "TrackCacheModule.kt"), TRACK_CACHE_MODULE_KT, "utf8");
            fs.writeFileSync(path.join(javaDir, "TrackCachePackage.kt"), TRACK_CACHE_PACKAGE_KT, "utf8");
            fs.writeFileSync(path.join(javaDir, "NasoSanBrowserService.kt"), BROWSER_SERVICE_KT, "utf8");
            fs.writeFileSync(path.join(javaDir, "CarModeModule.kt"), CAR_MODE_MODULE_KT, "utf8");
            fs.writeFileSync(path.join(javaDir, "CarModePackage.kt"), CAR_MODE_PACKAGE_KT, "utf8");
            return config;
        },
    ]);
}

// ── 5. Registra TrackCachePackage in MainApplication ─────────────────────────
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

// ── 6. Registra CarModePackage in MainApplication ────────────────────────────
function withCarModeMainAppPatch(config) {
    return withDangerousMod(config, ["android", function(config) {
        var mainAppPath = path.join(
            config.modRequest.platformProjectRoot,
            "app/src/main/java/com/nasosan/nasosanplayer/MainApplication.kt"
        );
        if (!fs.existsSync(mainAppPath)) return config;
        var src = fs.readFileSync(mainAppPath, "utf8");
        if (!src.includes("CarModePackage")) {
            if (src.includes("PackageList(this).packages.apply {")) {
                src = src.replace(
                    "PackageList(this).packages.apply {",
                    "PackageList(this).packages.apply {\n            add(CarModePackage())"
                );
            } else {
                src = src.replace(
                    "val packages = PackageList(this).packages",
                    "val packages = PackageList(this).packages\n                packages.add(CarModePackage())"
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
    config = withTrackCacheMainAppPatch(config);
    config = withCarModeMainAppPatch(config);
    return config;
};
