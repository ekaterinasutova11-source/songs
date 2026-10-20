import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:songs/data.dart';
import 'package:songs/main.dart';

class MemoryStore implements SessionStore {
  Session? value;
  @override
  Future<Session?> read() async => value;
  @override
  Future<void> save(Session session) async => value = session;
  @override
  Future<void> clear() async => value = null;
}

Map<String, dynamic> library({String role = 'student'}) => {
  'role': role,
  'students': [
    {
      'id': 'demo',
      'name': 'Моё пространство',
      'files': [
        {'name': 'Happy -.mp3', 'size': 123, 'modified': ''},
        {'name': 'Happy +.mp3', 'size': 123, 'modified': ''},
        {'name': 'Happy.txt', 'size': 123, 'modified': ''},
      ],
      'meta': {
        'happy': {'notes': 'Мягкое начало', 'translation': 'Счастье'},
      },
    },
  ],
};

void main() {
  testWidgets(
    'Personal link opens existing library and logout removes saved access',
    (tester) async {
      final store = MemoryStore();
      final api = SongsApi(
        client: MockClient((request) async {
          expect(jsonDecode(request.body)['action'], 'library');
          return http.Response(
            jsonEncode(library()),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      await tester.pumpWidget(SongsApp(api: api, store: store));
      await tester.pumpAndSettle();
      expect(find.text('Личная ссылка'), findsOneWidget);
      await tester.enterText(
        find.byType(TextField),
        'https://ekaterinasutova11-source.github.io/songs/#/s/test-key-1234',
      );
      await tester.tap(find.text('Открыть мои материалы'));
      await tester.pumpAndSettle();
      expect(find.text('Happy'), findsOneWidget);
      expect(store.value?.key, 'test-key-1234');
      await tester.tap(find.byTooltip('Выйти'));
      await tester.pumpAndSettle();
      expect(store.value, isNull);
      expect(find.text('Личная ссылка'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      api.close();
    },
  );

  testWidgets(
    'Access revocation hides previous library and retry restores same session',
    (tester) async {
      final store = MemoryStore()
        ..value = const Session(key: 'test-key-1234', mode: 's');
      var denied = false;
      final api = SongsApi(
        client: MockClient(
          (request) async => denied
              ? http.Response('Forbidden', 403)
              : http.Response(
                  jsonEncode(library()),
                  200,
                  headers: {'content-type': 'application/json; charset=utf-8'},
                ),
        ),
      );
      await tester.pumpWidget(SongsApp(api: api, store: store));
      await tester.pumpAndSettle();
      expect(find.text('Happy'), findsOneWidget);
      denied = true;
      await tester.tap(find.byTooltip('Обновить материалы'));
      await tester.pumpAndSettle();
      expect(find.text('Happy'), findsNothing);
      expect(find.textContaining('Доступ к материалам закрыт'), findsOneWidget);
      denied = false;
      await tester.tap(find.text('Проверить снова'));
      await tester.pumpAndSettle();
      expect(find.text('Happy'), findsOneWidget);
      expect(store.value?.key, 'test-key-1234');
      await tester.pumpWidget(const SizedBox());
      api.close();
    },
  );

  testWidgets('Saved song route loads lyrics, translation and notes', (
    tester,
  ) async {
    final store = MemoryStore()
      ..value = const Session(key: 'test-key-1234', mode: 's', song: 'happy');
    final api = SongsApi(
      client: MockClient((request) async {
        if (request.method == 'GET') {
          return http.Response('Because I am happy', 200);
        }
        final action = jsonDecode(request.body)['action'];
        return http.Response(
          jsonEncode(
            action == 'library'
                ? library()
                : {
                    'href':
                        'https://135.106.183.211/media?token=fake-test-only',
                  },
          ),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    await tester.pumpWidget(SongsApp(api: api, store: store));
    await tester.pumpAndSettle();
    expect(find.text('Минус'), findsOneWidget);
    expect(find.text('Плюс'), findsOneWidget);
    expect(find.text('Because I am happy'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Счастье'),100,scrollable:find.byType(Scrollable).first);
    expect(find.text('Счастье'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Мягкое начало'),
      150,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('Мягкое начало'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });

  testWidgets('Untrusted link never sends API request', (tester) async {
    var requests = 0;
    final api = SongsApi(
      client: MockClient((request) async {
        requests++;
        return http.Response('{}', 200);
      }),
    );
    await tester.pumpWidget(SongsApp(api: api, store: MemoryStore()));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField),
      'https://example.org/#/s/test-key-1234',
    );
    await tester.tap(find.text('Открыть мои материалы'));
    await tester.pumpAndSettle();
    expect(requests, 0);
    expect(find.textContaining('которую дал преподаватель'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });
}
