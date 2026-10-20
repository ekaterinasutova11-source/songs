import 'package:flutter/material.dart';

import 'data.dart';
import 'lyrics.dart';

const readingFonts = <String, TextStyle>{
  'Современный': TextStyle(fontFamily: 'Manrope', fontSize: 16, height: 1.9),
  'Книжный': TextStyle(fontFamily: 'Lora', fontSize: 17, height: 1.8),
  'Изящный': TextStyle(fontFamily: 'Cormorant', fontSize: 23, height: 1.6),
  'Простой': TextStyle(fontFamily: 'Roboto', fontSize: 17, height: 1.8),
  'Моноширинный': TextStyle(fontFamily: 'monospace', fontSize: 16, height: 1.8),
  'Классический': TextStyle(fontFamily: 'serif', fontSize: 18, height: 1.9),
  'Контрастный': TextStyle(
    fontFamily: 'sans-serif',
    fontSize: 18,
    fontWeight: FontWeight.w600,
    height: 1.9,
  ),
  'Просторный': TextStyle(
    fontFamily: 'Manrope',
    fontSize: 18,
    letterSpacing: 1.1,
    height: 2.2,
  ),
};
double? parseTimecode(String value) {
  final match = RegExp(r'^(\d{1,4}):([0-5]\d)(?:\.(\d{1,3}))?$')
      .firstMatch(value.trim());
  if (match == null) return null;
  final valueSeconds =
      int.parse(match[1]!) * 60 +
      int.parse(match[2]!) +
      (match[3] == null
          ? 0
          : int.parse(match[3]!) / [1, 10, 100, 1000][match[3]!.length]);
  return valueSeconds <= 86400 ? valueSeconds.toDouble() : null;
}

String timecode(double seconds) {
  final whole = seconds.floor();
  final milliseconds = ((seconds - whole) * 1000).round();
  return '${whole ~/ 60}:${(whole % 60).toString().padLeft(2, '0')}${milliseconds == 0 ? '' : '.${milliseconds.toString().padLeft(3, '0')}'}';
}

Map<String, dynamic>? validTimings(Song song, String text) {
  final raw = song.meta['timings'];
  if (raw is! Map) return null;
  final track = song.variants
      .where((v) => v.kind == 'minus' && v.file.name == raw['track'])
      .firstOrNull;
  if (raw['version'] != 1 ||
      track == null ||
      track.file.size != raw['trackSize'] ||
      track.file.modified != raw['trackModified'] ||
      song.lyricsFile?.name != raw['lyrics'] ||
      song.lyricsFile?.modified != raw['lyricsModified'] ||
      raw['lines'] is! List) {
    return null;
  }
  final lines = text.replaceFirst('\ufeff', '').split(RegExp(r'\r?\n'));
  final seen = <int>{};
  for (final entry in raw['lines'] as List) {
    if (entry is! Map || entry['line'] is! int || entry['seconds'] is! num) {
      return null;
    }
    final i = entry['line'] as int;
    final seconds = (entry['seconds'] as num).toDouble();
    if (i < 0 ||
        i >= lines.length ||
        !seen.add(i) ||
        !seconds.isFinite ||
        seconds < 0 ||
        seconds > 86400 ||
        entry['text'] != lines[i]) {
      return null;
    }
  }
  return Map<String, dynamic>.from(raw);
}

// Carry styles across line breaks while giving each row its own safe markup.
List<String> styledLines(String text) {
  final lines = <StringBuffer>[StringBuffer()];
  var endsWithStar = false;
  for (final run in parseLyrics(text.replaceAll('\r\n', '\n'))) {
    final chunks = run.text.split('\n');
    for (var i = 0; i < chunks.length; i++) {
      var part = chunks[i]
          .replaceAll('\\', r'\\')
          .replaceAll('*', r'\*')
          .replaceAll('_', r'\_')
          .replaceAll('=', r'\=')
          .replaceAll('[', r'\[');
      // Keep boundary spaces outside syntax delimiters.
      final m = RegExp(r'^(\s*)(.*?)(\s*)$', dotAll: true).firstMatch(part)!;
      part = m[2]!;
      if (part.isNotEmpty) {
        if (run.italic) part = '*$part*';
        if (run.bold) part = '**$part**';
        if (run.underline) part = '__${part}__';
        if (run.marked) part = '==$part==';
        if (run.highlight != null) part = '[mark=${run.highlight}]$part[/mark]';
        if (run.color != null) {
          part = run.color!.startsWith('#')
              ? '[color=${run.color}]$part[/color]'
              : '[${run.color}]$part[/${run.color}]';
        }
      }
      final formatted = '${m[1]}$part${m[3]}';
      if (formatted.isNotEmpty) {
        // The stored grammar reads ** before *. Keep adjacent run delimiters
        // separate without adding a space/character or changing text color.
        if (endsWithStar && formatted.startsWith('*')) {
          lines.last.write('[color=#000000][/color]');
        }
        lines.last.write(formatted);
        endsWithStar = formatted.endsWith('*');
      }
      if (i < chunks.length - 1) {
        lines.add(StringBuffer());
        endsWithStar = false;
      }
    }
  }
  return lines.map((l) => l.toString()).toList();
}

class TimedLyrics extends StatelessWidget {
  const TimedLyrics({
    super.key,
    required this.song,
    required this.text,
    required this.onSeek,
    this.style,
  });
  final Song song;
  final String text;
  final TextStyle? style;
  final void Function(AudioVariant, double) onSeek;
  @override
  Widget build(BuildContext context) {
    final timings = validTimings(song, text);
    if (timings == null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (song.meta['timings'] != null)
            const Padding(
              padding: EdgeInsets.only(bottom: 12),
              child: Text('Текст или минусовка изменились. Обновите таймкоды.'),
            ),
          FormattedLyrics(text, style: style),
        ],
      );
    }
    final values = {
      for (final row in timings['lines'] as List)
        row['line'] as int: (row['seconds'] as num).toDouble(),
    };
    final track = song.variants.firstWhere(
      (v) => v.file.name == timings['track'],
    );
    final lines = styledLines(text);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < lines.length; i++)
          InkWell(
            onTap: values.containsKey(i)
                ? () => onSeek(track, values[i]!)
                : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 62,
                    child: values.containsKey(i)
                        ? Padding(
                            padding: const EdgeInsets.only(top: 5),
                            child: Text(
                              timecode(values[i]!),
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.primary,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          )
                        : null,
                  ),
                  Expanded(
                    child: IgnorePointer(
                      child: FormattedLyrics(
                        lines[i].isEmpty ? ' ' : lines[i],
                        style: style,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class TimingEditorPage extends StatefulWidget {
  const TimingEditorPage({
    super.key,
    required this.song,
    required this.text,
    required this.save,
    required this.currentPosition,
  });
  final Song song;
  final String text;
  final Future<void> Function(Map<String, dynamic>?) save;
  final Duration? Function(String track) currentPosition;
  @override
  State<TimingEditorPage> createState() => _TimingEditorPageState();
}

class _TimingEditorPageState extends State<TimingEditorPage> {
  late final lines = widget.text
      .replaceFirst('\ufeff', '')
      .split(RegExp(r'\r?\n'));
  late final tracks = widget.song.variants
      .where((v) => v.kind == 'minus')
      .toList();
  late String? track =
      (validTimings(widget.song, widget.text)?['track'] as String?) ??
      tracks.firstOrNull?.file.name;
  late final controls = [
    for (var i = 0; i < lines.length; i++) TextEditingController(),
  ];
  bool _saving = false;
  bool _allowPop = false;
  late String? _initialTrack;
  late List<String> _initialValues;
  int _trackRevision = 0;
  bool get _dirty =>
      track != _initialTrack ||
      List.generate(
        controls.length,
        (i) => i,
      ).any((i) => controls[i].text != _initialValues[i]);
  String? _error;
  @override
  void initState() {
    super.initState();
    final data = validTimings(widget.song, widget.text);
    if (data != null) {
      for (final line in data['lines'] as List) {
        controls[line['line'] as int].text = timecode(
          (line['seconds'] as num).toDouble(),
        );
      }
    }
    _initialTrack = track;
    _initialValues = controls.map((c) => c.text).toList();
    for (final c in controls) {
      c.addListener(_changed);
    }
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _leave() async {
    if (_saving) return;
    final leave = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Выйти без сохранения таймкодов?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('Продолжить'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Выйти без сохранения'),
          ),
        ],
      ),
    );
    if (leave == true && mounted) {
      setState(() => _allowPop = true);
      Navigator.pop(context);
    }
  }

  Future<void> _changeTrack(String? value) async {
    if (value == null || value == track || _saving) return;
    var change = true;
    if (controls.any((c) => c.text.trim().isNotEmpty)) {
      change =
          await showDialog<bool>(
            context: context,
            builder: (c) => AlertDialog(
              title: const Text('Сменить минусовку?'),
              content: const Text(
                'Таймкоды текущей записи будут очищены. Для другой минусовки нужно указать время заново.',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(c, false),
                  child: const Text('Отмена'),
                ),
                TextButton(
                  onPressed: () => Navigator.pop(c, true),
                  child: const Text('Сменить и очистить'),
                ),
              ],
            ),
          ) ??
          false;
    }
    if (!mounted) return;
    setState(() {
      _trackRevision++;
      if (change) {
        track = value;
        for (final c in controls) {
          c.clear();
        }
      }
    });
  }

  Future<void> _save({bool clear = false}) async {
    if (_saving) return;
    Map<String, dynamic>? data;
    if (!clear) {
      final selected = tracks.where((v) => v.file.name == track).firstOrNull;
      if (selected == null || widget.song.lyricsFile == null) {
        setState(() => _error = 'Добавьте минусовку и сохраните текст песни.');
        return;
      }
      final values = <Map<String, dynamic>>[];
      for (var i = 0; i < lines.length; i++) {
        final value = controls[i].text.trim();
        if (value.isEmpty) continue;
        final seconds = parseTimecode(value);
        if (seconds == null) {
          setState(() => _error = 'Строка ${i + 1}: введите время вида 02:33.');
          return;
        }
        values.add({'line': i, 'seconds': seconds, 'text': lines[i]});
      }
      data = {
        'version': 1,
        'track': selected.file.name,
        'trackSize': selected.file.size,
        'trackModified': selected.file.modified,
        'lyrics': widget.song.lyricsFile!.name,
        'lyricsModified': widget.song.lyricsFile!.modified,
        'lines': values,
      };
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.save(data);
      if (mounted) {
        setState(() => _allowPop = true);
        Navigator.pop(context, true);
      }
    } on ApiFailure catch (e) {
      if (mounted) {
        setState(
          () => _error = e.status == 409
              ? 'Текст или минусовка изменились. Вернитесь к песне и обновите материалы.'
              : e.message,
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Не удалось сохранить. Проверьте интернет.');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_saving && (_allowPop || !_dirty),
    onPopInvokedWithResult: (didPop, result) {
      if (!didPop) _leave();
    },
    child: Scaffold(
      appBar: AppBar(
        title: const Text('Таймкоды строк'),
        actions: [
          TextButton(
            onPressed: _saving ? null : () => _save(),
            child: Text(_saving ? 'Сохраняем…' : 'Сохранить'),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'Выберите минусовку и укажите время у нужных строк. «Сейчас» берёт позицию этой записи из плеера.',
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: ValueKey('timing-track-$track-$_trackRevision'),
              initialValue: track,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Минусовка'),
              items: [
                for (final v in tracks)
                  DropdownMenuItem(
                    value: v.file.name,
                    child: Text(
                      v.displayName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: _saving ? null : _changeTrack,
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            for (var i = 0; i < lines.length; i++)
              if (lines[i].trim().isNotEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      FormattedLyrics(lines[i]),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: controls[i],
                              enabled: !_saving,
                              keyboardType: TextInputType.datetime,
                              decoration: InputDecoration(
                                labelText: 'Строка ${i + 1}: мм:сс',
                                hintText: '02:33',
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          TextButton(
                            onPressed: _saving
                                ? null
                                : () {
                                    final position = track == null
                                        ? null
                                        : widget.currentPosition(track!);
                                    if (position == null) {
                                      setState(
                                        () => _error = 'Сначала включите выбранную минусовку.',
                                      );
                                    } else {
                                      controls[i].text = timecode(
                                        position.inMilliseconds / 1000,
                                      );
                                    }
                                  },
                            child: const Text('Сейчас'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
            TextButton(
              onPressed: _saving ? null : () => _save(clear: true),
              child: const Text('Убрать все таймкоды'),
            ),
          ],
        ),
      ),
    ),
  );
  @override
  void dispose() {
    for (final c in controls) {
      c.dispose();
    }
    super.dispose();
  }
}
