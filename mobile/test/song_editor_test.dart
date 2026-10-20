import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart' as q;
import 'package:flutter_test/flutter_test.dart';
import 'package:songs/data.dart';
import 'package:songs/lyrics.dart';
import 'package:songs/song_editor.dart';
import 'package:songs/ui_settings.dart';

String _visible(String markup) =>
    parseLyrics(markup).map((run) => run.text).join();
List<Object> _semantic(String markup) => [
  for (final run in parseLyrics(markup))
    for (final rune in run.text.runes)
      [
        String.fromCharCode(rune),
        if (!RegExp(r'\s').hasMatch(String.fromCharCode(rune)))
          [run.bold, run.italic, run.underline],
        rune == 10 ? null : lyricColors[run.color] ?? run.color,
        rune == 10 ? null : run.highlight ?? (run.marked ? '#fff176' : null),
      ],
];

Future<void> _openEditor(
  WidgetTester tester, {
  String text = 'Строка',
  bool teacher = false,
  required Future<void> Function(SongEditResult) save,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: const [q.FlutterQuillLocalizations.delegate],
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute<void>(
                builder: (_) => SongEditorPage(
                  song: const Song(key: 'test', title: 'Тест', variants: []),
                  text: text,
                  teacher: teacher,
                  save: save,
                ),
              ),
            ),
            child: const Text('Библиотека'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Библиотека'));
  await tester.pumpAndSettle();
}

q.QuillController _controller(WidgetTester tester) =>
    tester.widget<q.QuillEditor>(find.byType(q.QuillEditor)).controller;

void main() {
  test(
    'all adjacent emphasis transitions preserve both visible character styles',
    () {
      Map<String, dynamic> attrs(int mask) => {
        if (mask & 1 != 0) 'bold': true,
        if (mask & 2 != 0) 'italic': true,
        if (mask & 4 != 0) 'underline': true,
      };
      for (var left = 0; left < 8; left++) {
        for (var right = 0; right < 8; right++) {
          final document = q.Document.fromJson([
            {'insert': 'a', 'attributes': attrs(left)},
            {'insert': 'b', 'attributes': attrs(right)},
            {'insert': '\n'},
          ]);
          final encoded = lyricsMarkup(document);
          final runs = parseLyrics(encoded);
          expect(_visible(encoded), 'ab', reason: '$left/$right: $encoded');
          final actual = [
            for (final run in runs)
              for (final _ in run.text.runes)
                [run.bold, run.italic, run.underline],
          ];
          expect(actual, [
            for (final mask in [left, right])
              [mask & 1 != 0, mask & 2 != 0, mask & 4 != 0],
          ], reason: '$left/$right: $encoded');
          document.close();
        }
      }
    },
  );

  final fixtures = jsonDecode(
    File('test/fixtures/lyrics_web.json').readAsStringSync(),
  ) as List;
  for (var index = 0; index < fixtures.length; index++) {
    test(
      'existing website fixture $index retains visible text and formatting after editing codec',
      () {
        final original = fixtures[index]['input'] as String;
        final document = lyricsDocument(original);
        final encoded = lyricsMarkup(document);
        expect(_visible(encoded), _visible(original));
        expect(_semantic(encoded), _semantic(original), reason: encoded);
        document.close();
      },
    );
  }

  test('sentinel never adds/removes real newlines, Cyrillic or emoji', () {
    for (final text in [
      '',
      '\n',
      '\n\n',
      'Текст',
      'Текст\n',
      'Текст\n\n',
      '👩🏽‍🎤 Привет 🎶\n\nТвой голос\n',
      '  строка  \n\tдругая\n',
    ]) {
      final document = lyricsDocument(text);
      expect(document.toPlainText(), '$text\n');
      expect(_visible(lyricsMarkup(document)), text);
      document.close();
    }
  });

  test('literal syntax cannot become formatting across document operation boundaries', () {
    final document = q.Document.fromJson([
      {'insert': '_'},
      {
        'insert': '_literal__ ==x== **stars** [red]text[/red] \\ 🎵',
        'attributes': {'color': '#1565c0'},
      },
      {'insert': '\n'},
    ]);
    final encoded = lyricsMarkup(document);
    expect(
      _visible(encoded),
      '__literal__ ==x== **stars** [red]text[/red] \\ 🎵',
    );
    expect(
      parseLyrics(encoded)
          .any((run) => run.bold || run.italic || run.underline || run.marked),
      isFalse,
    );
    document.close();
  });

  test('letter color, marker, underline and bold remain independent', () {
    final document = lyricsDocument(
      '[color=#123456][mark=#abcdef]**__Цвет__**[/mark][/color]',
    );
    document.format(0, 4, q.Attribute.fromKeyValue('background', '#90caf9')!);
    var runs = parseLyrics(lyricsMarkup(document));
    expect(runs.single.color, '#123456');
    expect(runs.single.highlight, '#90caf9');
    expect(runs.single.bold && runs.single.underline, isTrue);
    document.format(0, 4, q.Attribute.fromKeyValue('color', null)!);
    runs = parseLyrics(lyricsMarkup(document));
    expect(runs.single.color, isNull);
    expect(runs.single.highlight, '#90caf9');
    document.close();
  });

  testWidgets('saving untouched text preserves the exact original source', (
    tester,
  ) async {
    const original = '[red]**слово**[/red]\n\nконец\\';
    SongEditResult? saved;
    await _openEditor(
      tester,
      text: original,
      save: (value) async => saved = value,
    );
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();
    expect(saved?.text, original);
    expect(find.byType(SongEditorPage), findsNothing);
  });

  testWidgets('undo back to the original does not prompt or rewrite markup', (
    tester,
  ) async {
    SongEditResult? saved;
    const original = '[red]слово[/red]\n';
    await _openEditor(
      tester,
      text: original,
      save: (value) async => saved = value,
    );
    final controller = _controller(tester);
    controller.replaceText(
      0,
      0,
      'Новое ',
      const TextSelection.collapsed(offset: 6),
    );
    controller.undo();
    await tester.pump();
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();
    expect(saved?.text, original);
  });

  testWidgets(
    'cancel keeps the draft; explicit discard leaves without saving',
    (tester) async {
      var saves = 0;
      await _openEditor(
        tester,
        save: (_) async {
          saves++;
        },
      );
      final controller = _controller(tester);
      controller.replaceText(
        0,
        0,
        'Черновик ',
        const TextSelection.collapsed(offset: 9),
      );
      await tester.pump();
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text('Есть несохранённые изменения'), findsOneWidget);
      await tester.tap(find.text('Продолжить'));
      await tester.pumpAndSettle();
      expect(controller.document.toPlainText(), contains('Черновик'));
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Выйти без сохранения'));
      await tester.pumpAndSettle();
      expect(find.byType(SongEditorPage), findsNothing);
      expect(saves, 0);
    },
  );

  testWidgets('conflicting save retains draft and unlocks editing for retry', (
    tester,
  ) async {
    var saves = 0;
    SongEditResult? saved;
    await _openEditor(
      tester,
      save: (value) async {
        saves++;
        if (saves == 1) {
          throw const ApiFailure(409, 'Песня изменена на другом устройстве.');
        }
        saved = value;
      },
    );
    final controller = _controller(tester);
    controller.replaceText(
      0,
      0,
      'Черновик ',
      const TextSelection.collapsed(offset: 9),
    );
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();
    expect(find.text('Песня изменена на другом устройстве.'), findsOneWidget);
    expect(controller.document.toPlainText(), 'Черновик Строка\n');
    expect(controller.readOnly, isFalse);
    await tester.tap(find.text('Сохранить'));
    await tester.pumpAndSettle();
    expect(_visible(saved!.text), 'Черновик Строка');
  });

  testWidgets('pending save freezes keyboard editing and toolbar formatting', (
    tester,
  ) async {
    final pending = Completer<void>();
    await _openEditor(tester, save: (_) => pending.future);
    final controller = _controller(tester);
    await tester.tap(find.text('Сохранить'));
    await tester.pump();
    expect(controller.readOnly, isTrue);
    for (final tooltip in [
      'Жирный',
      'Курсив',
      'Подчёркнутый',
      'Цвет букв',
      'Цвет маркера',
    ]) {
      expect(
        tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (widget) => widget is IconButton && widget.tooltip == tooltip,
              ),
            )
            .onPressed,
        isNull,
      );
    }
    pending.complete();
    await tester.pumpAndSettle();
    expect(find.byType(SongEditorPage), findsNothing);
  });

  testWidgets('RGB picker validates channels and returns one safe color', (
    tester,
  ) async {
    String? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                selected = await showDialog<String>(
                  context: context,
                  builder: (_) =>
                      const SongColorDialog(marker: true, initial: '#abcdef'),
                );
              },
              child: const Text('Палитра'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Палитра'));
    await tester.pumpAndSettle();
    Finder field(String name) => find.byWidgetPredicate(
      (widget) => widget is TextField && widget.decoration?.labelText == name,
    );
    await tester.enterText(field('R'), '999');
    await tester.tap(find.text('Применить'));
    await tester.pumpAndSettle();
    expect(find.text('Каждый канал RGB: от 0 до 255.'), findsOneWidget);
    await tester.enterText(field('R'), '18');
    await tester.enterText(field('G'), '52');
    await tester.enterText(field('B'), '86');
    await tester.tap(find.text('Применить'));
    await tester.pumpAndSettle();
    expect(selected, '#123456');
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'toolbar applies marker and letter color independently; cancelling preserves selection',
    (tester) async {
      await _openEditor(tester, save: (_) async {});
      final controller = _controller(tester);
      controller.updateSelection(
        const TextSelection(baseOffset: 0, extentOffset: 6),
        q.ChangeSource.local,
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Цвет букв'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Выбрать цвет #1565c0'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Цвет маркера'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Выбрать цвет #a5d6a7'));
      await tester.pumpAndSettle();
      var style = controller.getSelectionStyle().attributes;
      expect(style['color']?.value, '#1565c0');
      expect(style['background']?.value, '#a5d6a7');
      final before = jsonEncode(controller.document.toDelta().toJson());
      await tester.tap(find.byTooltip('Цвет букв'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Отмена'));
      await tester.pumpAndSettle();
      expect(jsonEncode(controller.document.toDelta().toJson()), before);
      await tester.tap(find.byTooltip('Подчёркнутый'));
      await tester.pump();
      style = controller.getSelectionStyle().attributes;
      expect(style['underline']?.value, isTrue);
      expect(style['color']?.value, '#1565c0');
      expect(style['background']?.value, '#a5d6a7');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'compact native palette scrolls at large UI/system text with keyboard',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      tester.view.viewInsets = const FakeViewPadding(bottom: 180);
      tester.platformDispatcher.textScaleFactorTestValue = 1.5;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) =>
              ScaledInterface(scale: 1.5, child: child!),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => showDialog<String>(
                  context: context,
                  builder: (_) => const SongColorDialog(marker: true),
                ),
                child: const Text('Палитра'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Палитра'));
      await tester.pumpAndSettle();
      expect(find.text('Цвет маркера'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Отмена'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Палитра'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Отмена'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
}
