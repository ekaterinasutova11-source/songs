import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:songs/data.dart';
import 'package:songs/timed_lyrics.dart';
import 'package:songs/lyrics.dart';

Song timedSong({String modified = 'track-v1'}) => Song(
  key: 'demo',
  title: 'Demo',
  variants: [
    AudioVariant(
      kind: 'minus',
      label: '',
      file: SongFile(name: 'Demo -.mp3', size: 10, modified: modified),
    ),
  ],
  lyricsFile: const SongFile(name: 'Demo.txt', modified: 'text-v1'),
  meta: {
    'timings': {
      'version': 1,
      'track': 'Demo -.mp3',
      'trackSize': 10,
      'trackModified': 'track-v1',
      'lyrics': 'Demo.txt',
      'lyricsModified': 'text-v1',
      'lines': [
        {'line': 1, 'seconds': 153.25, 'text': 'Вторая строка'},
      ],
    },
  },
);
void main() {
  testWidgets('timing draft survives back and cannot leave while saving', (
    tester,
  ) async {
    final pending = Completer<void>();
    var writes = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => TimingEditorPage(
                    song: timedSong(),
                    text: 'Первая\nВторая строка',
                    currentPosition: (_) => null,
                    save: (_) async {
                      writes++;
                      await pending.future;
                    },
                  ),
                ),
              ),
              child: const Text('Открыть'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Открыть'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '00:01');
    await tester.pump();
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('Выйти без сохранения таймкодов?'), findsOneWidget);
    await tester.tap(find.text('Продолжить'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byType(TextField).first).controller!.text,
      '00:01',
    );
    await tester.tap(find.text('Сохранить'));
    await tester.pump();
    expect(writes, 1);
    await tester.tap(find.byType(BackButton));
    await tester.pump();
    expect(find.text('Таймкоды строк'), findsOneWidget);
    pending.complete();
    await tester.pumpAndSettle();
    expect(find.text('Открыть'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  test('timecodes reject malformed seconds, negative and beyond 24 hours', () {
    expect(parseTimecode('02:33'), 153);
    expect(parseTimecode('2:33.25'), 153.25);
    for (final input in ['-1:22', '01:60', '9999:00', '1.5', 'abc']) {
      expect(parseTimecode(input), isNull);
    }
    expect(timecode(153.25), '2:33.250');
  });
  test('binding invalidates on replacement, edit, or moved line', () {
    const text = 'Первая\nВторая строка';
    expect(validTimings(timedSong(), text), isNotNull);
    expect(validTimings(timedSong(modified: 'track-v2'), text), isNull);
    expect(
      validTimings(timedSong(), 'Новая строка\nПервая\nВторая строка'),
      isNull,
    );
  });
  test('line splitting preserves styles spanning multiple lines', () {
    final lines = styledLines(
      '**Первая\nВторая**\n[color=#00796b]Цвет[/color]',
    );
    expect(parseLyrics(lines[0]).single.bold, isTrue);
    expect(parseLyrics(lines[1]).single.bold, isTrue);
    expect(parseLyrics(lines[2]).single.color, '#00796b');
    expect(styledLines('A\r\nB').length, 2);
  });
  test(
    'line splitting keeps adjacent italic/bold runs and literal characters',
    () {
      for (final text in [
        '*a**b***',
        '**a*b***',
        '*a**b***\n[red]*a**b***[/red]',
        r'\*a\* __word__ [blue]**🎵**[/blue]',
      ]) {
        final before = parseLyrics(text);
        final after = parseLyrics(styledLines(text).join('\n'));
        List<Object> characters(List<LyricRun> runs) => [
          for (final run in runs)
            for (final rune in run.text.runes)
              [
                String.fromCharCode(rune),
                run.bold,
                run.italic,
                run.underline,
                run.marked,
                run.color,
                run.highlight,
              ],
        ];
        expect(characters(after), characters(before), reason: text);
      }
    },
  );
  testWidgets('tap on timed text and time starts the bound variant only', (
    tester,
  ) async {
    String? selected;
    double? position;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TimedLyrics(
            song: timedSong(),
            text: 'Первая\nВторая строка',
            onSeek: (track, seconds) {
              selected = track.file.name;
              position = seconds;
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('2:33.250'));
    await tester.pump();
    expect(selected, 'Demo -.mp3');
    expect(position, 153.25);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TimedLyrics(
            song: timedSong(modified: 'new'),
            text: 'Первая\nВторая строка',
            onSeek: (_, _) => fail('stale timing clicked'),
          ),
        ),
      ),
    );
    expect(find.textContaining('Обновите таймкоды'), findsOneWidget);
    expect(find.text('2:33.250'), findsNothing);
  });
}
