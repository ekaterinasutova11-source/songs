import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:songs/lyrics.dart';

String html(List<LyricRun> runs) => runs.map((run) {
  var result = run.text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  if (run.italic) result = '<i>$result</i>';
  if (run.bold) result = '<b>$result</b>';
  if (run.underline) result = '<u>$result</u>';
  if (run.marked) result = '<mark>$result</mark>';
  if (run.color != null) result = '<span class="c-${run.color}">$result</span>';
  return result;
}).join();

void main() {
  final fixtures = jsonDecode(
    File('test/fixtures/lyrics_web.json').readAsStringSync(),
  ) as List;
  test('Existing TXT markup matches 18 outputs from the website renderer', () {
    for (final fixture in fixtures) {
      expect(
        html(parseLyrics(fixture['input'] as String)),
        fixture['html'],
        reason: fixture['input'] as String,
      );
    }
  });
  testWidgets(
    'Lyrics remain selectable, styled and literal HTML never becomes a widget',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: FormattedLyrics(
              '**Слово** ==маркер== [red]цвет[/red] <b>буквально</b>',
            ),
          ),
        ),
      );
      final text = tester.widget<SelectableText>(find.byType(SelectableText));
      expect(
        text.textSpan!.toPlainText(),
        'Слово маркер цвет <b>буквально</b>',
      );
      final spans = text.textSpan!.children!.cast<TextSpan>();
      expect(spans.first.style!.fontWeight, FontWeight.w700);
      expect(
        spans.firstWhere((s) => s.text == 'маркер').style!.backgroundColor,
        const Color(0xfffff176),
      );
    },
  );
}
