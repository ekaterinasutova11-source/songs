import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:songs/brand.dart';
import 'package:songs/player.dart';

class _PreviewPlayer extends PlayerController {
  @override
  bool get hasTrack => true;
  @override
  String? get songTitle =>
      'Длинное название песни для проверки доступного места';
  @override
  String? get variantName => 'Минус · медленный';
  @override
  Duration get duration => const Duration(seconds: 180);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'Album art is a packaged PNG copied to a local file without network access',
    (tester) async {
      await tester.runAsync(() async {
        final directory = await Directory.systemTemp.createTemp(
          'songs-brand-test-',
        );
        const channel = MethodChannel('plugins.flutter.io/path_provider');
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async => directory.path);
        try {
          final uri = await gardenArtworkUri();
          expect(uri?.scheme, 'file');
          final file = File.fromUri(uri!);
          final bytes = await file.readAsBytes();
          expect(bytes.take(8).toList(), [137, 80, 78, 71, 13, 10, 26, 10]);
          expect(await gardenArtworkUri(), uri);
          await file.delete();
        } finally {
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(channel, null);
          await directory.delete();
        }
      });
    },
  );

  for (final brightness in Brightness.values) {
    testWidgets(
      'Player remains usable with large text in ${brightness.name} theme',
      (tester) async {
        tester.view.physicalSize = const Size(320, 640);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final controller = _PreviewPlayer();
        await tester.pumpWidget(
          MaterialApp(
            theme: gardenTheme(brightness),
            home: MediaQuery(
              data: MediaQueryData(
                size: const Size(320, 640),
                textScaler: TextScaler.linear(1.5),
              ),
              child: Scaffold(
                body: SingleChildScrollView(
                  child: SongsPlayer(controller: controller),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.byTooltip('Воспроизвести'), findsOneWidget);
        expect(find.byType(Image), findsOneWidget);
        await tester.pumpWidget(const SizedBox());
        controller.dispose();
      },
    );
  }
}
