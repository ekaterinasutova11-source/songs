package ru.sadzvuka.songs

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.abs

class MetronomePcmTest {
    private fun render(core: MetronomePcm, count: Int) {
        var left = count
        while (left > 0) {
            val size = minOf(480, left)
            core.render(ShortArray(size))
            left -= size
        }
    }

    @Test fun sampleClockHasLessThanOneFrameErrorAfterThreeMinutes() {
        val core = MetronomePcm(MetronomeSettings(bpm = 137))
        val frames = mutableListOf<Long>()
        core.onBeat = { _, frame -> frames.add(frame) }
        render(core, 48000 * 180)
        assertTrue(frames.size > 400)
        frames.forEachIndexed { index, frame ->
            val ideal = index * 48000.0 * 60 / 137
            assertTrue("sample drift at $index: $frame vs $ideal", abs(frame - ideal) <= 1.00001)
        }
    }

    @Test fun mutedBeatsKeepTheirTimeAndCount() {
        val core = MetronomePcm(MetronomeSettings(bpm = 120,
            activeBeats = listOf(true, false, true, false)))
        val hits = mutableListOf<Long>()
        val beats = mutableListOf<Int>()
        core.onHit = { _, frame -> hits.add(frame) }
        core.onBeat = { beat, _ -> beats.add(beat) }
        render(core, 48000 * 3)
        assertEquals(listOf(0L, 48000L, 96000L), hits)
        assertEquals(listOf(1, 2, 3, 4, 1, 2), beats)
    }

    @Test fun tempoChangePreservesTheFractionOfTheCurrentInterval() {
        val core = MetronomePcm(MetronomeSettings(bpm = 120))
        val hits = mutableListOf<Long>()
        core.onHit = { _, frame -> hits.add(frame) }
        render(core, 12000)
        core.update(MetronomeSettings(bpm = 60))
        render(core, 24001)
        assertEquals(listOf(0L, 36000L), hits)
    }

    @Test fun allWebRhythmsHaveValidHitsAndSynthesizeAudiblePcm() {
        assertEquals(setOf("click", "pop", "soft", "rock", "hiphop", "waltz", "funk",
            "latin", "breakbeat", "shuffle", "popfill", "rockfill"), DrumPatterns.all.keys)
        for ((id, pattern) in DrumPatterns.all) {
            assertTrue(pattern.steps > 0)
            assertTrue(pattern.subdivisions in 1..4)
            pattern.hits.values.flatten().forEach { assertTrue(it in 0 until pattern.steps) }
            val core = MetronomePcm(MetronomeSettings(pattern = id, isTeacher = true))
            val pcm = ShortArray(48000)
            core.render(pcm)
            assertTrue("silent rhythm $id", pcm.any { it.toInt() != 0 })
            assertTrue(pcm.all { abs(it.toInt()) <= 30000 })
        }
    }

    @Test fun popPositionsMatchTheWebsite() {
        val core = MetronomePcm(MetronomeSettings(bpm = 120, pattern = "pop", isTeacher = true))
        val kick = mutableListOf<Long>()
        val snare = mutableListOf<Long>()
        core.onHit = { name, frame ->
            if (name == "kick") kick.add(frame)
            if (name == "snare") snare.add(frame)
        }
        render(core, 96000)
        assertEquals(listOf(0L, 48000L), kick)
        assertEquals(listOf(24000L, 72000L), snare)
    }

    @Test fun settingsRejectUnknownPatternsPupilDrumsAndInvalidMasks() {
        for (factory in listOf(
            { MetronomeSettings(pattern = "pop") },
            { MetronomeSettings(pattern = "unknown", isTeacher = true) },
            { MetronomeSettings(beats = 13) },
            { MetronomeSettings(activeBeats = listOf(true)) },
            { MetronomeSettings(volume = Double.NaN) }
        )) {
            try { factory(); fail("invalid settings accepted") } catch (_: IllegalArgumentException) { }
        }
    }
}
