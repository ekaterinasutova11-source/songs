import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:songs/data.dart';
import 'package:songs/main.dart';
import 'package:songs/ui_settings.dart';

class _UiStore implements UiSettingsStore {
  double? value;
  @override
  Future<double?> readScale() async => value;
  @override
  Future<void> writeScale(double scale) async => value = scale;
}

class _SessionStore implements SessionStore {
  Session? value = const Session(key: 'fake-scale-key', mode: 's');
  @override
  Future<Session?> read() async => value;
  @override
  Future<void> save(Session session) async => value = session;
  @override
  Future<void> clear() async => value = null;
}

void main() {
  testWidgets(
    '150% interface and large system text keep phone navigation and settings usable',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 1.5;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final store = _SessionStore()
        ..value = const Session(
          key: 'fake-scale-key',
          mode: 's',
          song: 'happy',
        );
      final api = SongsApi(
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'role': 'student',
              'students': [
                {
                  'id': 'own',
                  'name': 'Мои песни',
                  'files': [
                    {'name': 'Happy.mp3'},
                  ],
                  'meta': {},
                },
              ],
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ),
        ),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        api.close();
      });
      await tester.pumpWidget(
        SongsApp(api: api, store: store, uiStore: _UiStore()..value = 1.5),
      );
      await tester.pumpAndSettle();
      expect(find.byType(BackButton), findsOneWidget);
      expect(find.text('Happy'), findsOneWidget);
      expect(find.byTooltip('Размер интерфейса'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byTooltip('Размер интерфейса'));
      await tester.pumpAndSettle();
      expect(find.text('150%'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Готово'));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Happy'),
        120,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(find.text('Happy'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  test(
    'display scale defaults safely, clamps saved values, and serializes writes',
    () async {
      final store = _UiStore()..value = 9;
      final settings = UiSettingsController(store);
      expect(settings.scale, 1);
      await settings.load();
      expect(settings.scale, 1.5);
      final first = settings.setScale(.85);
      final second = settings.setScale(1.3);
      await Future.wait([first, second]);
      expect(store.value, 1.3);
      await settings.setScale(double.nan);
      expect(settings.scale, 1.3);
      settings.dispose();
    },
  );

  test('late preference load cannot overwrite a newer user choice', () async {
    final pending = Completer<double?>();
    final store = _DelayedUiStore(pending);
    final settings = UiSettingsController(store);
    final loading = settings.load();
    await settings.setScale(1.15);
    pending.complete(.85);
    await loading;
    expect(settings.scale, 1.15);
    settings.dispose();
  });

  testWidgets(
    'whole-interface scale preserves OS text size and physical insets',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      late MediaQueryData inner;
      const probe = Key('scaled-probe');
      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: MediaQuery(
            data: const MediaQueryData(
              size: Size(320, 640),
              textScaler: TextScaler.linear(1.7),
              padding: EdgeInsets.only(top: 24),
              viewPadding: EdgeInsets.only(top: 24),
              viewInsets: EdgeInsets.only(bottom: 200),
            ),
            child: ScaledInterface(
              scale: 1.5,
              child: Builder(
                builder: (context) {
                  inner = MediaQuery.of(context);
                  return const Align(
                    alignment: Alignment.topLeft,
                    child: SizedBox(key: probe, width: 48, height: 48),
                  );
                },
              ),
            ),
          ),
        ),
      );
      expect(inner.textScaler.scale(10), 17);
      expect(inner.size.width, closeTo(320 / 1.5, .001));
      expect(inner.padding.top * 1.5, 24);
      expect(inner.viewInsets.bottom * 1.5, closeTo(200, .001));
      final box = tester.renderObject<RenderBox>(find.byKey(probe));
      final physicalWidth =
          (box.localToGlobal(const Offset(48, 0)) -
                  box.localToGlobal(Offset.zero))
              .dx;
      expect(
        physicalWidth,
        72,
        reason: 'Icons/buttons grow with text, not text alone.',
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Aa choices persist across logout and restart and reset to 100%',
    (tester) async {
      final uiStore = _UiStore();
      final sessionStore = _SessionStore();
      final api = SongsApi(
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'role': 'student',
              'students': [
                {'id': 'own', 'name': 'Личное', 'files': [], 'meta': {}},
              ],
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          ),
        ),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        api.close();
      });
      await tester.pumpWidget(
        SongsApp(api: api, store: sessionStore, uiStore: uiStore),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Размер интерфейса'));
      await tester.pumpAndSettle();
      for (final option in ['85%', '100%', '115%', '130%', '150%']) {
        expect(find.text(option), findsOneWidget);
      }
      await tester.tap(find.text('130%'));
      await tester.pumpAndSettle();
      expect(uiStore.value, 1.3);
      await tester.tap(find.text('Готово'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Выйти'));
      await tester.pumpAndSettle();
      expect(sessionStore.value, isNull);
      expect(uiStore.value, 1.3);
      await tester.pumpWidget(
        SongsApp(
          key: UniqueKey(),
          api: api,
          store: sessionStore,
          uiStore: uiStore,
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester.widget<ScaledInterface>(find.byType(ScaledInterface)).scale,
        1.3,
      );
      await tester.tap(find.byTooltip('Размер интерфейса'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Сбросить до 100%'));
      await tester.pumpAndSettle();
      expect(uiStore.value, 1);
      expect(
        tester.widget<ScaledInterface>(find.byType(ScaledInterface)).scale,
        1,
      );
      expect(tester.takeException(), isNull);
    },
  );
}

class _DelayedUiStore implements UiSettingsStore {
  _DelayedUiStore(this.pending);
  final Completer<double?> pending;
  @override
  Future<double?> readScale() => pending.future;
  @override
  Future<void> writeScale(double scale) async {}
}
