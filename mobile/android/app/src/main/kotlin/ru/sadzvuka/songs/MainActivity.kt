package ru.sadzvuka.songs

import com.ryanheise.audioservice.AudioServiceActivity
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.EventChannel

class MainActivity : AudioServiceActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        MethodChannel(messenger, "songs/metronome").setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "start" -> {
                        val settings = MetronomeBridge.parse(call.arguments)
                        if (Build.VERSION.SDK_INT >= 33 &&
                            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7341)
                        }
                        MetronomeBridge.start(this, settings)
                        result.success(MetronomeBridge.snapshot())
                    }
                    "update" -> {
                        MetronomeBridge.update(MetronomeBridge.parse(call.arguments))
                        result.success(MetronomeBridge.snapshot())
                    }
                    "stop" -> { MetronomeBridge.stop(this); result.success(MetronomeBridge.snapshot()) }
                    "state" -> result.success(MetronomeBridge.snapshot())
                    else -> result.notImplemented()
                }
            } catch (_: IllegalArgumentException) {
                result.error("invalid_settings", "Проверьте настройки метронома.", null)
            } catch (_: Exception) {
                result.error("metronome_unavailable", "Не удалось включить метроном.", null)
            }
        }
        EventChannel(messenger, "songs/metronome/events").setStreamHandler(object: EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
                MetronomeBridge.sink = events
                events.success(MetronomeBridge.snapshot())
            }
            override fun onCancel(arguments: Any?) { MetronomeBridge.sink = null }
        })
    }
}
