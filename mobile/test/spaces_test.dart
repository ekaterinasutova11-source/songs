import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:songs/data.dart';
import 'package:songs/main.dart';
import 'package:songs/ui_settings.dart';

class _Store implements SessionStore {
  Session? value = const Session(key: 'test-spaces-key', mode: 's');
  @override
  Future<Session?> read() async => value;
  @override
  Future<void> save(Session session) async => value = session;
  @override
  Future<void> clear() async => value = null;
}

class _UiStore implements UiSettingsStore {
  @override
  Future<double?> readScale() async => 1;
  @override
  Future<void> writeScale(double scale) async {}
}

Map<String, dynamic> _library({bool duet = true, bool includePeer = false}) => {
  'role': 'student',
  'ownId': 'own',
  'students': [
    {
      'id': 'own',
      'name': 'Моё личное',
      'kind': 'individual',
      'files': [
        {'name': 'Personal song.mp3'},
      ],
      'meta': {},
    },
    if (duet)
      {
        'id': 'duet',
        'name': 'Наш дуэт',
        'kind': 'duet',
        'files': [
          {'name': 'Together.mp3'},
          {'name': 'Together.txt'},
        ],
        'meta': {},
      },
    {
      'id': 'ensemble',
      'name': 'Ансамбль',
      'kind': 'ensemble',
      'files': [
        {'name': 'Choir.mp3'},
      ],
      'meta': {},
    },
    if (includePeer)
      {
        'id': 'peer',
        'name': 'Чужой ученик',
        'kind': 'individual',
        'files': [],
        'meta': {},
      },
  ],
};

http.Response _json(Object value) => http.Response(
  jsonEncode(value),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

Future<void> _switch(WidgetTester tester, String id) async {
  final field = tester.widget<DropdownButtonFormField<String>>(
    find.byType(DropdownButtonFormField<String>),
  );
  field.onChanged!(id);
  await tester.pumpAndSettle();
}

void main() {
  test('new space routes preserve encoded IDs and original pupil links', () {
    final group = Session.parse(
      'https://135.106.183.211/#/s/test-spaces-key/space/duet%20one/song/together',
    );
    expect(group.folder, 'duet one');
    expect(group.song, 'together');
    expect(Session.fromJson(group.toJson()).folder, 'duet one');
    expect(
      Session.parse('https://135.106.183.211/#/s/test-spaces-key').folder,
      isNull,
    );
  });

  test(
    'library opts in to memberships and rejects personal peer spaces',
    () async {
      final api = SongsApi(
        client: MockClient((request) async {
          expect(jsonDecode(request.body)['includeSpaces'], isTrue);
          return _json(_library(includePeer: true));
        }),
      );
      await expectLater(
        api.library(const Session(key: 'test-spaces-key', mode: 's')),
        throwsA(isA<ApiFailure>()),
      );
      api.close();
    },
  );

  testWidgets(
    'pupil switches own/duet/ensemble without logout; refresh keeps selection',
    (tester) async {
      var duet = true;
      final store = _Store();
      final api = SongsApi(
        client: MockClient((request) async => _json(_library(duet: duet))),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        api.close();
      });
      await tester.pumpWidget(
        SongsApp(api: api, store: store, uiStore: _UiStore()),
      );
      await tester.pumpAndSettle();
      expect(find.text('Мои пространства'), findsOneWidget);
      expect(find.text('Personal song'), findsOneWidget);
      await _switch(tester, 'duet');
      expect(find.text('Together'), findsOneWidget);
      expect(find.text('Personal song'), findsNothing);
      await tester.tap(find.byTooltip('Обновить материалы'));
      await tester.pumpAndSettle();
      expect(find.text('Together'), findsOneWidget);
      await _switch(tester, 'ensemble');
      expect(find.text('Choir'), findsOneWidget);
      await _switch(tester, 'duet');
      duet = false;
      await tester.tap(find.byTooltip('Обновить материалы'));
      await tester.pumpAndSettle();
      expect(find.text('Personal song'), findsOneWidget);
      expect(find.text('Together'), findsNothing);
      expect(find.textContaining('Доступ к материалам закрыт'), findsNothing);
      expect(store.value, isNotNull);
      // A stale/forged local selection cannot open another pupil's space.
      await _switch(tester, 'peer');
      expect(find.text('Personal song'), findsOneWidget);
      expect(find.text('Чужой ученик'), findsNothing);
      expect(
        tester.widget<Text>(find.text('Personal song')).style?.fontSize,
        19,
      );
    },
  );

  testWidgets(
    '403 for a removed group returns to own materials and discards pending text',
    (tester) async {
      var member = true;
      final pendingText = Completer<http.Response>();
      final store = _Store()
        ..value = const Session(
          key: 'test-spaces-key',
          mode: 's',
          folder: 'duet',
          song: 'together',
        );
      final api = SongsApi(
        client: MockClient((request) async {
          if (request.method == 'GET') return pendingText.future;
          if (jsonDecode(request.body)['action'] == 'library') {
            return _json(_library(duet: member));
          }
          return _json({'href': '$serverOrigin/media?token=fake-group-text'});
        }),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        api.close();
      });
      await tester.pumpWidget(
        SongsApp(api: api, store: store, uiStore: _UiStore()),
      );
      for (var i = 0; i < 6; i++) {
        await tester.pump();
      }
      expect(find.text('Together'), findsOneWidget);
      member = false;
      pendingText.complete(http.Response('Forbidden', 403));
      await tester.pumpAndSettle();
      expect(find.text('Personal song'), findsOneWidget);
      expect(find.text('Together'), findsNothing);
      expect(find.textContaining('Доступ к материалам закрыт'), findsNothing);
      expect(store.value, isNotNull);
    },
  );
}
