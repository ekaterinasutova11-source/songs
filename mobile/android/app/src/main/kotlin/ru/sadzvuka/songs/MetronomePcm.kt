package ru.sadzvuka.songs

import kotlin.math.*

data class DrumPattern(
    val id: String, val name: String, val steps: Int, val subdivisions: Int,
    val hits: Map<String, Set<Int>>, val levels: Map<String, Double>
)

data class MetronomeSettings(
    val bpm: Int = 80, val beats: Int = 4,
    val activeBeats: List<Boolean> = List(4) { true },
    val volume: Double = 0.6, val accent: Boolean = true,
    val pattern: String = "click", val isTeacher: Boolean = false
) {
    init {
        require(bpm in 40..240 && beats in 1..12)
        require(activeBeats.size == beats)
        require(volume.isFinite() && volume in 0.0..1.0)
        require(DrumPatterns.all.containsKey(pattern))
        require(isTeacher || pattern == "click")
    }
    val rhythm: DrumPattern get() = DrumPatterns.all.getValue(pattern)
}

/** Pure PCM clock. UI timers, method-channel latency and song position cannot
 * move a beat. Fractional frame deadlines prevent cumulative rounding drift. */
class MetronomePcm(initial: MetronomeSettings, val sampleRate: Int = 48000) {
    var settings = initial
        private set
    var frame: Long = 0
        private set
    private var step: Long = 0
    private var nextFrame = 0.0
    private val voices = mutableListOf<Voice>()
    private val samples = VoiceSynth(sampleRate)
    var onBeat: ((beat: Int, frame: Long) -> Unit)? = null
    var onHit: ((voice: String, frame: Long) -> Unit)? = null

    private fun period(config: MetronomeSettings) =
        sampleRate * 60.0 / config.bpm / config.rhythm.subdivisions

    fun update(value: MetronomeSettings) {
        if (value == settings) return
        val old = settings
        val oldPeriod = period(old)
        settings = value
        if (value.pattern != old.pattern) {
            step = 0
            nextFrame = frame + period(value)
            voices.clear()
        } else if (value.bpm != old.bpm) {
            val phaseRemaining = ((nextFrame - frame) / oldPeriod).coerceIn(0.0, 1.0)
            nextFrame = frame + phaseRemaining * period(value)
        }
    }

    fun render(output: ShortArray) {
        for (index in output.indices) {
            if (frame.toDouble() + 1e-7 >= nextFrame) {
                trigger()
                step++
                nextFrame += period(settings)
            }
            var mix = 0.0
            var voiceIndex = voices.lastIndex
            while (voiceIndex >= 0) {
                val voice = voices[voiceIndex]
                mix += voice.samples[voice.position++] * voice.level
                if (voice.position >= voice.samples.size) voices.removeAt(voiceIndex)
                voiceIndex--
            }
            output[index] = (tanh(mix * settings.volume) * 30000).roundToInt().toShort()
            frame++
        }
    }

    private fun trigger() {
        val pattern = settings.rhythm
        val beat = ((step / pattern.subdivisions) % settings.beats).toInt()
        if (step % pattern.subdivisions == 0L) onBeat?.invoke(beat + 1, frame)
        // Muting a beat silences its subdivisions; the sample clock keeps going.
        if (!settings.activeBeats[beat]) {
            if (step % pattern.subdivisions == 0L) voices.clear()
            return
        }
        if (pattern.id == "click") {
            add(if (settings.accent && beat == 0) "accent" else "click", 0.7)
        } else {
            val position = (step % pattern.steps).toInt()
            val velocity = if (position % pattern.subdivisions != 0) 0.65
                else if (settings.accent && beat == 0) 1.18 else 1.0
            for ((name, hits) in pattern.hits) {
                if (position in hits) add(name, velocity * (pattern.levels[name] ?: 1.0))
            }
        }
    }

    private fun add(name: String, level: Double) {
        voices.add(Voice(samples.get(name), level))
        onHit?.invoke(name, frame)
    }
    private data class Voice(val samples: DoubleArray, val level: Double, var position: Int = 0)
}

/** Deterministic original sounds: pitched oscillators, filtered noise and envelopes. */
private class VoiceSynth(private val rate: Int) {
    private val cache = mutableMapOf<String, DoubleArray>()
    private data class Spec(val duration: Double, val level: Double, val start: Double,
        val end: Double = start, val waveform: String = "sine", val noise: Boolean = false)
    private val specs = mapOf(
        "click" to Spec(.04, .65, 880.0), "accent" to Spec(.04, .75, 1320.0),
        "kick" to Spec(.22, .8, 145.0, 45.0),
        "rim" to Spec(.04, .22, 650.0, 300.0, "triangle"),
        "tomhigh" to Spec(.18, .48, 260.0, 130.0),
        "tomlow" to Spec(.28, .55, 150.0, 70.0),
        "congahigh" to Spec(.095, .3, 520.0, 260.0, "triangle"),
        "congalow" to Spec(.16, .4, 330.0, 160.0),
        "cowbell" to Spec(.065, .055, 830.0, 800.0, "square"),
        "snare" to Spec(.15, .3, 1800.0, noise = true),
        "ghost" to Spec(.07, .065, 1800.0, noise = true),
        "clap" to Spec(.16, .28, 1200.0, noise = true),
        "hat" to Spec(.05, .12, 7000.0, noise = true),
        "openhat" to Spec(.23, .13, 6500.0, noise = true),
        "ride" to Spec(.32, .09, 8500.0, noise = true),
        "shaker" to Spec(.05, .08, 4500.0, noise = true)
    )

    init { specs.keys.forEach { get(it) } }

    fun get(name: String): DoubleArray = cache.getOrPut(name) {
        val spec = specs.getValue(name)
        val result = DoubleArray((rate * spec.duration).toInt())
        var phase = 0.0
        var seed = 137
        val filter = NoiseFilter(spec.start, rate, name == "hat" || name == "openhat")
        for (i in result.indices) {
            val t = i.toDouble() / rate
            val frequency = spec.start * (spec.end / spec.start).pow(t / spec.duration)
            phase += 2 * PI * frequency / rate
            val raw = if (spec.noise) {
                seed = seed xor (seed shl 13)
                seed = seed xor (seed ushr 17)
                seed = seed xor (seed shl 5)
                filter.next(seed.toDouble() / Int.MAX_VALUE)
            } else when (spec.waveform) {
                "triangle" -> 2.0 / PI * asin(sin(phase))
                "square" -> if (sin(phase) >= 0) 1.0 else -1.0
                else -> sin(phase)
            }
            val attack = min(1.0, t / .002)
            var envelope = attack * exp(-7 * t / spec.duration)
            if (name == "clap") {
                for (offset in doubleArrayOf(.012, .024)) {
                    if (t >= offset) envelope += .8 * exp(-100 * (t - offset))
                }
            }
            result[i] = raw * envelope * spec.level
        }
        result
    }

    private class NoiseFilter(frequency: Double, rate: Int, highPass: Boolean) {
        private val omega = 2 * PI * frequency / rate
        private val alpha = sin(omega) / (2 * .7)
        private val a0 = 1 + alpha
        private val b0 = if (highPass) (1 + cos(omega)) / 2 / a0 else alpha / a0
        private val b1 = if (highPass) -(1 + cos(omega)) / a0 else 0.0
        private val b2 = if (highPass) b0 else -alpha / a0
        private val a1 = -2 * cos(omega) / a0
        private val a2 = (1 - alpha) / a0
        private var x1 = 0.0; private var x2 = 0.0
        private var y1 = 0.0; private var y2 = 0.0
        fun next(input: Double): Double {
            val y = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = input; y2 = y1; y1 = y
            return y
        }
    }
}
