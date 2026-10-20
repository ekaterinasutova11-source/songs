import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:songs/data.dart';
import 'package:songs/main.dart';

// Deliberately fake personal links; these tests never contact production.
const _personalLink = 'https://135.106.183.211/#/s/test-key-races';

class _MemoryStore implements SessionStore {
  Session? value;
  Completer<void>? saveGate;
  final operations = <String>[];

  @override
  Future<Session?> read() async => value;

  @override
  Future<void> save(Session session) async {
    operations.add('save-start');
    await saveGate?.future;
    value = session;
    operations.add('save-end');
  }

  @override
  Future<void> clear() async {
    operations.add('clear');
    value = null;
  }
}

http.Response _libraryResponse() => http.Response(
  jsonEncode({
    'role': 'student',
    'students': [
      {
        'id': 'demo',
        'name': 'Тестовое пространство',
        'files': [
          {'name': 'Happy -.mp3'},
          {'name': 'Happy.txt'},
        ],
        'meta': {},
      },
    ],
  }),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

// A pending HTTP/storage request intentionally keeps a progress animation alive;
// settling every frame would hide the very ordering this suite exercises.
Future<void> _flush(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump();
  }
}

Future<void> _login(WidgetTester tester) async {
  await tester.enterText(find.byType(TextField), _personalLink);
  await tester.tap(find.text('Открыть мои материалы'));
  await _flush(tester);
}

void main() {
  testWidgets(
    'late library response after logout cannot restore saved access',
    (tester) async {
      final pendingLibrary = Completer<http.Response>();
      final store = _MemoryStore();
      var requests = 0;
      final api = SongsApi(
        client: MockClient((request) {
          requests++;
          expect(jsonDecode(request.body)['action'], 'library');
          return pendingLibrary.future;
        }),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        api.close();
      });
      await tester.pumpWidget(SongsApp(api: api, store: store));
      await tester.pumpAndSettle();
      await _login(tester);
      expect(requests, 1);
      expect(find.byTooltip('Выйти'), findsOneWidget);
      expect(find.text('Happy'), findsNothing);

      await tester.tap(find.byTooltip('Выйти'));
      await tester.pumpAndSettle();
      expect(find.text('Личная ссылка'), findsOneWidget);
      pendingLibrary.complete(_libraryResponse());
      await tester.pumpAndSettle();

      expect(find.text('Личная ссылка'), findsOneWidget);
      expect(find.text('Happy'), findsNothing);
      expect(find.byTooltip('Выйти'), findsNothing);
      expect(store.value, isNull);
      expect(store.operations, ['clear']);
      await tester.pump(const Duration(seconds: 61));
      expect(
        requests,
        1,
        reason: 'The refresh timer must not use a logged-out session.',
      );
    },
  );

  testWidgets('lyrics 403 invalidates a library refresh already in flight', (
    tester,
  ) async {
    final pendingLyrics = Completer<http.Response>();
    final pendingRefresh = Completer<http.Response>();
    final store = _MemoryStore()
      ..value = const Session(key: 'test-key-races', mode: 's', song: 'happy');
    var libraryRequests = 0;
    var lyricsRequests = 0;
    final api = SongsApi(
      client: MockClient((request) async {
        if (request.method == 'GET') {
          lyricsRequests++;
          return pendingLyrics.future;
        }
        if (jsonDecode(request.body)['action'] == 'library') {
          libraryRequests++;
          return libraryRequests == 1
              ? _libraryResponse()
              : pendingRefresh.future;
        }
        return http.Response(
          jsonEncode({'href': '$serverOrigin/media?token=fake-test-ticket'}),
          200,
        );
      }),
    );
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      api.close();
    });
    await tester.pumpWidget(SongsApp(api: api, store: store));
    await _flush(tester);
    expect(lyricsRequests, 1);
    expect(find.text('Happy'), findsOneWidget);
    await tester.tap(find.byTooltip('Обновить материалы'));
    await _flush(tester);
    expect(libraryRequests, 2);

    pendingLyrics.complete(http.Response('Access revoked', 403));
    await tester.pumpAndSettle();
    expect(find.textContaining('Доступ к материалам закрыт'), findsOneWidget);
    expect(find.text('Happy'), findsNothing);
    pendingRefresh.complete(_libraryResponse());
    await tester.pumpAndSettle();

    expect(find.textContaining('Доступ к материалам закрыт'), findsOneWidget);
    expect(find.text('Happy'), findsNothing);
    expect(lyricsRequests, 1);
    expect(
      store.value,
      isNotNull,
      reason: 'Revocation keeps the link for a later explicit access recheck.',
    );
  });

  testWidgets(
    'logout queues clear after an already-started secure-store save',
    (tester) async {
      final saveGate = Completer<void>();
      final store = _MemoryStore()..saveGate = saveGate;
      final api = SongsApi(client: MockClient((_) async => _libraryResponse()));
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        api.close();
      });
      await tester.pumpWidget(SongsApp(api: api, store: store));
      await tester.pumpAndSettle();
      await _login(tester);
      expect(store.operations, ['save-start']);
      expect(
        find.text('Happy'),
        findsNothing,
        reason:
            'The login progress screen remains visible while storing access.',
      );
      expect(find.byTooltip('Выйти'), findsOneWidget);

      await tester.tap(find.byTooltip('Выйти'));
      await _flush(tester);
      expect(find.byTooltip('Выйти'), findsNothing);
      expect(store.operations, [
        'save-start',
      ], reason: 'Clear must wait until the previous save finishes.');
      saveGate.complete();
      await tester.pumpAndSettle();

      expect(store.operations, ['save-start', 'save-end', 'clear']);
      expect(store.value, isNull);
      expect(find.text('Личная ссылка'), findsOneWidget);
      expect(find.text('Happy'), findsNothing);
    },
  );
}
