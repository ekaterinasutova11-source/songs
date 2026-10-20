package ru.sadzvuka.songs

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.Process
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max

/** The audio device paces the blocking writes. No sleeps or UI-thread timers. */
class MetronomeEngine(
    settings: MetronomeSettings,
    private val onBeat: (Int, Long) -> Unit,
    private val onError: () -> Unit
) {
    private val running = AtomicBoolean(false)
    private val config = AtomicReference(settings)
    @Volatile private var track: AudioTrack? = null

    fun update(settings: MetronomeSettings) { config.set(settings) }

    fun start() {
        if (!running.compareAndSet(false, true)) return
        Thread({ render() }, "SongsMetronomePCM").start()
    }

    private fun render() {
        var native: AudioTrack? = null
        try {
            Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
            val rate = 48000
            val frames = 480
            val pcm = MetronomePcm(config.get(), rate)
            pcm.onBeat = onBeat
            val minimum = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT)
            require(minimum > 0)
            val builder = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(AudioFormat.Builder().setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(max(minimum, frames * 2 * 4))
            if (Build.VERSION.SDK_INT >= 26) builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
            native = builder.build()
            require(native.state == AudioTrack.STATE_INITIALIZED)
            track = native
            if (!running.get()) return
            native.play()
            val buffer = ShortArray(frames)
            while (running.get()) {
                pcm.update(config.get())
                pcm.render(buffer)
                var offset = 0
                while (running.get() && offset < buffer.size) {
                    val written = native.write(buffer, offset, buffer.size - offset, AudioTrack.WRITE_BLOCKING)
                    check(written > 0)
                    offset += written
                }
            }
        } catch (_: Exception) {
            if (running.getAndSet(false)) onError()
        } finally {
            track = null
            try { native?.pause(); native?.flush() } catch (_: Exception) { }
            native?.release()
        }
    }

    fun stop() {
        running.set(false)
        // Immediately discard queued sound; release belongs to the render thread.
        try { track?.pause(); track?.flush() } catch (_: Exception) { }
    }
}
