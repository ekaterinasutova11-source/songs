package ru.sadzvuka.songs

// Rhythm data mirrors DRUM_PATTERNS in metronome.js. Sounds are synthesized.
object DrumPatterns {
    val all: Map<String, DrumPattern> = linkedMapOf(
        "click" to DrumPattern("click", "Щелчки", 4, 1, mapOf(), mapOf()),
        "pop" to DrumPattern("pop", "Поп · 4/4", 16, 4, mapOf("kick" to setOf(0, 8), "snare" to setOf(4, 12), "hat" to setOf(0, 2, 4, 6, 8, 10, 12, 14)), mapOf()),
        "soft" to DrumPattern("soft", "Мягкий · 4/4", 16, 4, mapOf("kick" to setOf(0, 8), "rim" to setOf(4, 12), "shaker" to setOf(0, 2, 4, 6, 8, 10, 12, 14)), mapOf()),
        "rock" to DrumPattern("rock", "Рок · 4/4", 16, 4, mapOf("kick" to setOf(0, 6, 8, 10), "snare" to setOf(4, 12), "hat" to setOf(0, 2, 4, 6, 8, 10, 12, 14)), mapOf()),
        "hiphop" to DrumPattern("hiphop", "Хип-хоп · 4/4", 16, 4, mapOf("kick" to setOf(0, 7, 10), "snare" to setOf(4, 12), "hat" to setOf(0, 2, 4, 6, 8, 10, 12, 14, 15)), mapOf()),
        "waltz" to DrumPattern("waltz", "Вальс · 3/4", 12, 4, mapOf("kick" to setOf(0), "rim" to setOf(4, 8), "shaker" to setOf(0, 2, 4, 6, 8, 10)), mapOf()),
        "funk" to DrumPattern("funk", "Фанк · шуршащий", 32, 4, mapOf("kick" to setOf(0, 3, 10, 16, 22, 26, 30), "snare" to setOf(4, 12, 20, 28), "hat" to setOf(0, 1, 2, 4, 5, 7, 8, 9, 10, 12, 13, 15, 16, 17, 18, 20, 21, 23, 24, 25, 26, 28, 29, 31), "ghost" to setOf(7, 15, 19, 25, 31), "openhat" to setOf(6, 14, 23, 30)), mapOf("hat" to 0.65)),
        "latin" to DrumPattern("latin", "Латина · конги", 32, 4, mapOf("shaker" to setOf(0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30), "congalow" to setOf(0, 6, 12, 16, 22, 28), "congahigh" to setOf(3, 7, 10, 14, 19, 23, 26, 29, 31), "cowbell" to setOf(0, 6, 10, 16, 20, 26)), mapOf()),
        "breakbeat" to DrumPattern("breakbeat", "Брейкбит · ломаный", 32, 4, mapOf("kick" to setOf(0, 6, 10, 16, 19, 26, 30), "snare" to setOf(4, 12, 20, 27, 28, 31), "hat" to setOf(0, 2, 7, 8, 11, 16, 18, 22, 25, 29), "ghost" to setOf(9, 15, 23), "openhat" to setOf(14, 24), "clap" to setOf(12, 28)), mapOf("snare" to 1.2, "clap" to 0.6)),
        "shuffle" to DrumPattern("shuffle", "Шаффл · джазовый", 24, 3, mapOf("kick" to setOf(0, 12), "rim" to setOf(3, 9, 15, 21), "ghost" to setOf(8, 20), "ride" to setOf(0, 3, 5, 6, 9, 11, 12, 15, 17, 18, 21, 23)), mapOf("kick" to 0.65)),
        "popfill" to DrumPattern("popfill", "Поп · хлопки и сбивка", 64, 4, mapOf("kick" to setOf(0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56), "shaker" to setOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 50, 52, 54, 56), "openhat" to setOf(2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50, 54), "congahigh" to setOf(59, 62), "clap" to setOf(4, 12, 20, 28, 36, 44, 52, 58, 60, 61, 63)), mapOf("shaker" to 0.6)),
        "rockfill" to DrumPattern("rockfill", "Рок · томы и сбивка", 64, 4, mapOf("kick" to setOf(0, 6, 8, 10, 16, 22, 24, 26, 32, 38, 40, 42, 48, 54, 56), "snare" to setOf(4, 12, 20, 28, 36, 44, 52, 57), "ride" to setOf(0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54), "tomhigh" to setOf(58, 59), "tomlow" to setOf(60, 62, 63)), mapOf("snare" to 1.25, "ride" to 0.8))
    )
}
