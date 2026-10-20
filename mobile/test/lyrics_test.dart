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
  if (run.highlight != null) {
    result =
        '<mark style="background-color:${run.highlight};color:inherit">$result</mark>';
  } else if (run.marked) {
    result = '<mark>$result</mark>';
  }
  if (run.color?.startsWith('#') == true) {
    result = '<span style="color:${run.color}">$result</span>';
  } else if (run.color != null) {
    result = '<span class="c-${run.color}">$result</span>';
  }
  return result;
}).join();

void main() {
  test('Independent custom text and marker colors match the web syntax', () {
    final runs = parseLyrics(
      '[color=#123456]a[mark=#FFEEDD]b[color=#AABBCC]c[/color]d[/mark]e[/color]f',
    );
    expect(runs.map((r) => [r.text, r.color, r.highlight]).toList(), [
      ['a', '#123456', null],
      ['b', '#123456', '#ffeedd'],
      ['c', '#aabbcc', '#ffeedd'],
      ['d', '#123456', '#ffeedd'],
      ['e', '#123456', null],
      ['f', null, null],
    ]);
    expect(
      html(parseLyrics('[color=#123456][mark=#abcdef]слово[/mark][/color]')),
      '<span style="color:#123456"><mark style="background-color:#abcdef;color:inherit">слово</mark></span>',
    );
    const unsafe =
        '[color=red;position:fixed]x[/color] <script>alert(1)</script>';
    expect(parseLyrics(unsafe).map((r) => r.text).join(), unsafe);
  });
  testWidgets('Custom marker keeps independently selected letter color', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: FormattedLyrics(
            '[color=#123456][mark=#abcdef]Цвет[/mark][/color]',
          ),
        ),
      ),
    );
    final text = tester.widget<SelectableText>(find.byType(SelectableText));
    final span = text.textSpan!.children!.single as TextSpan;
    expect(span.style!.color, const Color(0xff123456));
    expect(span.style!.backgroundColor, const Color(0xffabcdef));
  });
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
