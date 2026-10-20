// Rasterize the existing website vector at native launcher/album-art sizes.
// Run: flutter test tool/generate_brand_assets_test.dart
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:songs/brand.dart';

Future<void> render(String path, int pixels, {bool cover = false}) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder)..scale(pixels / 1024);
  final rect = const Rect.fromLTWH(0, 0, 1024, 1024);
  canvas.drawRect(
    rect,
    Paint()
      ..shader = ui.Gradient.linear(
        Offset.zero,
        const Offset(1024, 1024),
        cover
            ? [const Color(0xff79558c), const Color(0xff403449)]
            : [const Color(0xfffdfafd), const Color(0xffe9dcf1)],
      ),
  );
  final ink = cover ? const Color(0xfff5f0f7) : const Color(0xff79558c);
  if (cover) {
    canvas.drawCircle(
      const Offset(512, 420),
      282,
      Paint()..color = const Color(0x18ffffff),
    );
    canvas.drawCircle(
      const Offset(512, 420),
      316,
      Paint()
        ..color = const Color(0x35ffffff)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
  }
  canvas.save();
  canvas.translate(cover ? 294 : 248, cover ? 190 : 220);
  paintGardenSprout(canvas, Size.square(cover ? 436 : 528), ink);
  canvas.restore();
  if (cover) {
    final title = TextPainter(
      text: TextSpan(
        text: 'Сад звука',
        style: TextStyle(
          fontFamily: 'Cormorant',
          fontSize: 100,
          fontWeight: FontWeight.w500,
          color: ink,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: 950);
    title.paint(canvas, Offset((1024 - title.width) / 2, 735));
    final caption = TextPainter(
      text: TextSpan(
        text: 'МЕСТО, ГДЕ РАСТЁТ ГОЛОС',
        style: TextStyle(
          fontFamily: 'Manrope',
          fontSize: 22,
          letterSpacing: 4,
          color: ink,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout(maxWidth: 950);
    caption.paint(canvas, Offset((1024 - caption.width) / 2, 875));
  }
  final picture = recorder.endRecording();
  final image = await picture.toImage(pixels, pixels);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  final file = File(path);
  await file.parent.create(recursive: true);
  await file.writeAsBytes(bytes!.buffer.asUint8List());
  image.dispose();
  picture.dispose();
}

void main() {
  testWidgets(
    'Generate existing sprout for native platforms and media artwork',
    (tester) async {
      await tester.runAsync(() async {
        for (final font in {
          'Cormorant': 'assets/fonts/1724047c8988ca5155bf.ttf',
          'Manrope': 'assets/fonts/a13d9b41b0a471ce58f0.ttf',
        }.entries) {
          await (FontLoader(
            font.key,
          )..addFont(rootBundle.load(font.value))).load();
        }
        await render('assets/brand/cover.png', 1024, cover: true);
        await render('assets/brand/mark.png', 256);
        for (final density in {
          'mdpi': 48,
          'hdpi': 72,
          'xhdpi': 96,
          'xxhdpi': 144,
          'xxxhdpi': 192,
        }.entries) {
          await render(
            'android/app/src/main/res/mipmap-${density.key}/ic_launcher.png',
            density.value,
          );
        }
        final path = 'ios/Runner/Assets.xcassets/AppIcon.appiconset';
        final catalog =
            jsonDecode(await File('$path/Contents.json').readAsString()) as Map;
        final done = <String>{};
        for (final entry in catalog['images'] as List) {
          final name = entry['filename'] as String?;
          if (name == null || !done.add(name)) continue;
          final size = double.parse((entry['size'] as String).split('x').first);
          final scale = double.parse(
            (entry['scale'] as String).replaceAll('x', ''),
          );
          await render('$path/$name', (size * scale).round());
        }
      });
    },
  );
}
