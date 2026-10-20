import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:songs/main.dart';
import 'package:songs/data.dart';
import 'package:songs/player.dart';

import 'widget_test.dart' show MemoryStore;

class PlayingPreview extends PlayerController {
  int stops = 0;
  bool active = true;
  @override
  bool get hasTrack => active;
  @override
  String? get songTitle => active ? 'Playing song' : null;
  @override
  String? get variantName => 'Минус';
  @override
  String? get playingFolderId => active ? 'a' : null;
  @override
  String? get playingFileName => active ? 'Playing song -.mp3' : null;
  @override
  Future<void> stop() async {
    stops++;
    active = false;
    notifyListeners();
  }
}

void main() {
  testWidgets(
    'navigation among pupils preserves audio; removal and logout stop it',
    (tester) async {
      final store = MemoryStore()
        ..value = const Session(key: 'test-teacher-key', mode: 't');
      final player = PlayingPreview();
      var removed = false;
      final api = SongsApi(
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'role': 'teacher',
              'students': [
                for (final id in ['a', 'b'])
                  {
                    'id': id,
                    'name': id == 'a' ? 'Первый ученик' : 'Второй ученик',
                    'files': id == 'a' && !removed
                        ? [
                            {'name': 'Playing song -.mp3'},
                          ]
                        : [],
                    'meta': {},
                  },
              ],
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ),
        ),
      );
      await tester.pumpWidget(SongsApp(api: api, store: store, player: player));
      await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Второй ученик'),100,scrollable:find.byType(Scrollable).first);
      await tester.tap(find.text('Второй ученик'));
      await tester.pumpAndSettle();
      expect(player.stops, 0);
      expect(find.text('Playing song'), findsOneWidget);
      await tester.tap(find.text('Сад звука'));
      await tester.pumpAndSettle();
      expect(player.stops, 0);
      await tester.tap(find.byTooltip('Обновить материалы'));
      await tester.pumpAndSettle();
      expect(player.stops, 0);
      removed = true;
      await tester.tap(find.byTooltip('Обновить материалы'));
      await tester.pumpAndSettle();
      expect(player.stops, 1);
      await tester.tap(find.byTooltip('Выйти'));
      await tester.pumpAndSettle();
      expect(player.stops, 2);
      await tester.pumpWidget(const SizedBox());
      api.close();
    },
  );
}
