import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:songs/data.dart';
import 'package:songs/main.dart';

class _PreviewStore implements SessionStore {
  @override
  Future<Session?> read() async =>
      const Session(key: 'preview-only-key', mode: 's', song: 'happy');
  @override
  Future<void> save(Session session) async {}
  @override
  Future<void> clear() async {}
}

void main() {
  testWidgets('Song page fits a phone viewport and renders local fonts', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final font in {
      'Manrope': 'assets/fonts/a13d9b41b0a471ce58f0.ttf',
      'Cormorant': 'assets/fonts/1724047c8988ca5155bf.ttf',
      'MaterialIcons': 'fonts/MaterialIcons-Regular.otf',
    }.entries) {
      await (FontLoader(font.key)..addFont(rootBundle.load(font.value))).load();
    }
    final api = SongsApi(
      client: MockClient((request) async {
        if (request.method == 'GET') {
          return http.Response(
            'Здесь будет текст вашей песни.\nЕго можно читать во время занятия и воспроизведения музыки.',
            200,
            headers: {'content-type': 'text/plain; charset=utf-8'},
          );
        }
        final body = jsonDecode(request.body);
        return http.Response(
          jsonEncode(
            body['action'] == 'url'
                ? {'href': '$serverOrigin/media?token=preview-not-real'}
                : {
                    'role': 'student',
                    'students': [
                      {
                        'id': 'preview',
                        'name': 'Моё пространство',
                        'files': [
                          {'name': 'Happy -.mp3'},
                          {'name': 'Happy +.mp3'},
                          {'name': 'Happy.txt'},
                        ],
                        'meta': {
                          'happy': {
                            'notes': 'Начни мягко, почувствуй ритм. Не торопись — у голоса есть время.',
                          },
                        },
                      },
                    ],
                  },
          ),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    final boundaryKey = GlobalKey();
    await tester.pumpWidget(
      RepaintBoundary(
        key: boundaryKey,
        child: SongsApp(api: api, store: _PreviewStore()),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Минус'), findsOneWidget);
    expect(
      find.textContaining('Здесь будет текст вашей песни.'),
      findsOneWidget,
    );
    await tester.runAsync(() async {
      final image =
          await (boundaryKey.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary)
              .toImage(pixelRatio: 2);
      final png = await image.toByteData(format: ui.ImageByteFormat.png);
      final output = File('../outputs/mobile-song-preview.png');
      await output.parent.create(recursive: true);
      await output.writeAsBytes(png!.buffer.asUint8List());
      image.dispose();
    });
    await tester.pumpWidget(const SizedBox());
    api.close();
  });
}
