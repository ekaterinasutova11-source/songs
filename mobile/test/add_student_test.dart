import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:songs/add_student.dart';
import 'package:songs/data.dart';
import 'package:songs/main.dart';

import 'widget_test.dart' show MemoryStore, library;

void main() {
  test(
    'create is teacher-only, trims names, and reports duplicate names',
    () async {
      var requests = 0;
      final api = SongsApi(
        client: MockClient((request) async {
          requests++;
          final body = jsonDecode(request.body);
          expect(body['action'], 'createStudent');
          expect(body['name'], 'Новая ученица');
          return http.Response('{}', requests == 1 ? 200 : 409);
        }),
      );
      const teacher = Session(key: 'test-key-1234', mode: 't');
      await expectLater(
        api.createStudent(
          const Session(key: 'test-key-1234', mode: 's'),
          'Имя',
        ),
        throwsA(isA<ApiFailure>()),
      );
      await expectLater(
        api.createStudent(teacher, '  '),
        throwsA(isA<ApiFailure>()),
      );
      expect(requests, 0);
      await api.createStudent(teacher, ' Новая ученица ');
      await expectLater(
        api.createStudent(teacher, 'Новая ученица'),
        throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 409)),
      );
      api.close();
    },
  );

  testWidgets('dialog validates empty name and prevents double submission', (
    tester,
  ) async {
    final pending = Completer<void>();
    var creates = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AddStudentDialog(
            create: (_) {
              creates++;
              return pending.future;
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('Добавить'));
    await tester.pump();
    expect(find.text('Введите имя ученика.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Ученица');
    await tester.tap(find.text('Добавить'));
    await tester.pump();
    expect(creates, 1);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    await tester.pumpWidget(const SizedBox());
    pending.complete();
    await tester.pump();
  });

  testWidgets('uncertain result requires checking list before retry', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AddStudentDialog(
            create: (_) async {
              throw const ApiFailure(0, 'timeout');
            },
          ),
        ),
      ),
    );
    await tester.enterText(find.byType(TextField), 'Ученица');
    await tester.tap(find.text('Добавить'));
    await tester.pumpAndSettle();
    expect(find.text('Проверить список'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('teacher creates pupil then home logo returns to pupils', (
    tester,
  ) async {
    final store = MemoryStore()
      ..value = const Session(key: 'test-key-1234', mode: 't');
    var created = false;
    final api = SongsApi(
      client: MockClient((request) async {
        final body = jsonDecode(request.body);
        if (body['action'] == 'createStudent') {
          expect(body['name'], 'Новая ученица');
          created = true;
          return http.Response('{}', 200);
        }
        final data = library(role: 'teacher');
        if (created) {
          (data['students'] as List).add({
            'id': 'new',
            'name': 'Новая ученица',
            'files': [],
            'meta': {},
          });
        }
        return http.Response(
          jsonEncode(data),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    await tester.pumpWidget(SongsApp(api: api, store: store));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Добавить ученика'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Имя ученика'),
      'Новая ученица',
    );
    await tester.tap(find.text('Добавить'));
    await tester.pumpAndSettle();
    expect(created, isTrue);
    expect(find.text('Новая ученица'), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    await tester.ensureVisible(find.text('Новая ученица'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Новая ученица'));
    await tester.pumpAndSettle();
    expect(find.text('Пространства учеников'), findsNothing);
    await tester.tap(find.text('Сад звука'));
    await tester.pumpAndSettle();
    expect(find.text('Пространства учеников'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });
}
