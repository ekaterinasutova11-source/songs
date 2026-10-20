import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

// The same sprout as index.html; a code-native mark, not a new logo.
Path gardenSprout() => Path()
  ..moveTo(16, 27)
  ..lineTo(16, 14)
  ..moveTo(16, 19)
  ..cubicTo(5, 19, 3, 10, 6, 5)
  ..cubicTo(14, 4, 18, 10, 16, 19)
  ..moveTo(16, 15)
  ..cubicTo(16, 7, 20, 3, 27, 4)
  ..cubicTo(29, 11, 24, 17, 16, 15);

void paintGardenSprout(Canvas canvas, Size size, Color color) {
  canvas.save();
  canvas.scale(size.width / 32, size.height / 32);
  canvas.drawPath(
    gardenSprout(),
    Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round,
  );
  canvas.restore();
}

class GardenMark extends StatelessWidget {
  const GardenMark({super.key, this.size = 32, this.color});
  final double size;
  final Color? color;
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: CustomPaint(
      size: Size.square(size),
      painter: _SproutPainter(color ?? Theme.of(context).colorScheme.primary),
    ),
  );
}

class _SproutPainter extends CustomPainter {
  const _SproutPainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size size) =>
      paintGardenSprout(canvas, size, color);
  @override
  bool shouldRepaint(_SproutPainter oldDelegate) => color != oldDelegate.color;
}

ThemeData gardenTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final bg = Color(dark ? 0xff24212c : 0xfff5f0f7);
  final surface = Color(dark ? 0xff2e2838 : 0xfffdfafd);
  final ink = Color(dark ? 0xfff0e7f4 : 0xff403449);
  final muted = Color(dark ? 0xffbfacc9 : 0xff766580);
  final accent = Color(dark ? 0xffd1ace5 : 0xff79558c);
  final line = Color(dark ? 0xff51425f : 0xffdcd0e4);
  final colors = ColorScheme.fromSeed(seedColor: accent, brightness: brightness)
      .copyWith(
        primary: accent,
        onPrimary: dark ? const Color(0xff31203d) : const Color(0xfffff8ff),
        surface: surface,
        onSurface: ink,
        onSurfaceVariant: muted,
        outline: line,
        primaryContainer: Color(dark ? 0xff4b3858 : 0xffe9dcf1),
        onPrimaryContainer: ink,
      );
  final base = ThemeData(
    colorScheme: colors,
    brightness: brightness,
    fontFamily: 'Manrope',
  );
  return base.copyWith(
    scaffoldBackgroundColor: bg,
    textTheme: base.textTheme.copyWith(
      headlineLarge: TextStyle(
        fontFamily: 'Cormorant',
        fontWeight: FontWeight.w500,
        fontSize: 42,
        height: 1.08,
        color: ink,
      ),
      headlineMedium: TextStyle(
        fontFamily: 'Cormorant',
        fontWeight: FontWeight.w500,
        fontSize: 30,
        color: ink,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: bg,
      foregroundColor: ink,
      centerTitle: false,
      scrolledUnderElevation: 0,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: line),
      ),
    ),
    cardTheme: CardThemeData(
      color: surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(22),
        side: BorderSide(color: line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    sliderTheme: SliderThemeData(
      trackHeight: 3,
      activeTrackColor: accent,
      thumbColor: accent,
      inactiveTrackColor: line,
    ),
  );
}

({Color ink, Color fill}) variantPalette(String kind, Brightness brightness) {
  final dark = brightness == Brightness.dark;
  return switch (kind) {
    'minus' => (
      ink: Color(dark ? 0xffb0d7c0 : 0xff466659),
      fill: Color(dark ? 0xff2d4037 : 0xffe4eee7),
    ),
    'plus' => (
      ink: Color(dark ? 0xffd6b2ec : 0xff75518a),
      fill: Color(dark ? 0xff44334f : 0xffeee3f4),
    ),
    _ => (
      ink: Color(dark ? 0xffdcc7a2 : 0xff716047),
      fill: Color(dark ? 0xff403a2d : 0xfff1ebdf),
    ),
  };
}

Future<Uri?>? _artwork;
Future<Uri?> gardenArtworkUri() => _artwork ??= _copyArtwork();
Future<Uri?> _copyArtwork() async {
  try {
    final directory = await getApplicationSupportDirectory();
    final file = File('${directory.path}/garden-artwork-v1.png');
    if (!await file.exists()) {
      final bytes = await rootBundle.load('assets/brand/cover.png');
      await file.writeAsBytes(
        bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes),
        flush: true,
      );
    }
    return file.uri;
  } catch (_) {
    // Artwork must never prevent a lesson or expose app-private paths.
    _artwork = null;
    return null;
  }
}
