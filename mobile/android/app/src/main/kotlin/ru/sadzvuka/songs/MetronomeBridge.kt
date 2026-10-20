package ru.sadzvuka.songs

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.EventChannel
import java.util.concurrent.atomic.AtomicLong

object MetronomeBridge {
    private val handler = Handler(Looper.getMainLooper())
    val generation = AtomicLong(0)
    @Volatile var desiredRunning = false
    var settings = MetronomeSettings()
    private var state: Map<String, Any?> = mapOf("running" to false, "beat" to 0)
    var sink: EventChannel.EventSink? = null

    fun parse(arguments: Any?): MetronomeSettings {
        val data = arguments as? Map<*, *> ?: throw IllegalArgumentException("settings")
        val beats = (data["beats"] as? Number)?.toInt() ?: 4
        val mask = (data["activeBeats"] as? List<*>)?.map {
            it as? Boolean ?: throw IllegalArgumentException("activeBeats")
        } ?: List(beats.coerceIn(1, 12)) { true }
        return MetronomeSettings(
            bpm = (data["bpm"] as? Number)?.toInt() ?: 80, beats = beats,
            activeBeats = mask, volume = (data["volume"] as? Number)?.toDouble() ?: .6,
            accent = data["accent"] as? Boolean ?: true,
            pattern = data["pattern"] as? String ?: "click",
            isTeacher = data["isTeacher"] as? Boolean ?: false
        )
    }

    fun snapshot(): Map<String, Any?> = state + mapOf(
        "generation" to generation.get(),
        "bpm" to settings.bpm, "beats" to settings.beats,
        "activeBeats" to settings.activeBeats, "volume" to settings.volume,
        "accent" to settings.accent, "pattern" to settings.pattern
    )

    fun publish(running: Boolean, beat: Int = 0, error: String? = null) {
        state = mapOf("running" to running, "beat" to beat, "error" to error)
        sink?.success(snapshot())
    }

    fun emitBeat(beat: Int, frame: Long, token: Long) {
        handler.post {
            if (desiredRunning && token == generation.get()) {
                state = mapOf("running" to true, "beat" to beat, "frame" to frame)
                sink?.success(snapshot())
            }
        }
    }

    fun start(context: Context, config: MetronomeSettings) {
        settings = config
        if (desiredRunning && MetronomeService.instance != null) {
            MetronomeService.instance?.update(config)
            return
        }
        val token = generation.incrementAndGet()
        desiredRunning = true
        val intent = Intent(context, MetronomeService::class.java)
            .setAction(MetronomeService.START).putExtra("generation", token)
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
            else context.startService(intent)
        } catch (failure: Exception) {
            desiredRunning = false
            publish(false, error = "Не удалось запустить метроном. Откройте приложение и повторите.")
            throw failure
        }
        publish(true)
    }

    fun update(config: MetronomeSettings) {
        settings = config
        MetronomeService.instance?.update(config)
    }

    fun stop(context: Context) {
        desiredRunning = false
        generation.incrementAndGet()
        MetronomeService.instance?.stopSound()
        context.stopService(Intent(context, MetronomeService::class.java))
        publish(false)
    }
}
