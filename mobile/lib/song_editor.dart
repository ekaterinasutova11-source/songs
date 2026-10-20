import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_quill/flutter_quill.dart' as q;

import 'data.dart';
import 'lyrics.dart';

const lyricColors = <String, String>{
  'red': '#c62828',
  'blue': '#1565c0',
  'green': '#2e7d32',
  'purple': '#7b1fa2',
};

q.Document lyricsDocument(String markup) {
  final ops = <Map<String, dynamic>>[];
  for (final run in parseLyrics(markup)) {
    final attrs = <String, dynamic>{
      if (run.bold) 'bold': true,
      if (run.italic) 'italic': true,
      if (run.underline) 'underline': true,
      if (run.color != null) 'color': lyricColors[run.color] ?? run.color,
      if (run.highlight != null || run.marked)
        'background': run.highlight ?? '#fff176',
    };
    final parts = run.text.split('\n');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].isNotEmpty) {
        ops.add({
          'insert': parts[i],
          if (attrs.isNotEmpty) 'attributes': attrs,
        });
      }
      if (i < parts.length - 1) ops.add({'insert': '\n'});
    }
  }
  // One separate terminal sentinel preserves real trailing line breaks.
  ops.add({'insert': '\n'});
  return q.Document.fromJson(ops);
}

typedef _Tag = ({String identity, String open, String close});
typedef _Unit = ({String text, Map<dynamic, dynamic> attrs});
List<_Tag> _emphasis(Map<dynamic, dynamic> attrs) => [
  if (attrs['bold'] == true) (identity: 'bold', open: '**', close: '**'),
  if (attrs['italic'] == true) (identity: 'italic', open: '*', close: '*'),
  if (attrs['underline'] == true)
    (identity: 'underline', open: '__', close: '__'),
];
int _common(List<_Tag> a, List<_Tag> b) {
  var count = 0;
  while (count < a.length && count < b.length && a[count] == b[count]) {
    count++;
  }
  return count;
}

String _escaped(String text) =>
    const ['\\', '*', '_', '=', '['].contains(text) ? '\\$text' : text;

String lyricsMarkup(q.Document doc) {
  final units = <_Unit>[];
  var remaining = doc.toPlainText().length - 1;
  for (final op in doc.toDelta().toJson()) {
    final insert = op['insert'];
    if (insert is! String || remaining <= 0) continue;
    final text = insert.substring(0, insert.length.clamp(0, remaining));
    remaining -= text.length;
    for (final rune in text.runes) {
      units.add((
        text: String.fromCharCode(rune),
        attrs: op['attributes'] as Map? ?? const {},
      ));
    }
  }
  bool whitespace(_Unit unit) => RegExp(r'\s').hasMatch(unit.text);
  final nextStyles = List<List<_Tag>>.filled(units.length, const []);
  var next = <_Tag>[];
  for (var i = units.length - 1; i >= 0; i--) {
    nextStyles[i] = next;
    if (!whitespace(units[i])) next = _emphasis(units[i].attrs);
  }
  final result = StringBuffer();
  var starDelimiter = false;
  void delimiter(String token) {
    if (starDelimiter && token.startsWith('*')) {
      // The legacy grammar tokenizes ** before *. A balanced empty color span
      // separates adjacent closers/openers without adding text or changing any
      // character's color (unlike an inserted space or zero-width character).
      result.write('[color=#000000][/color]');
    }
    result.write(token);
    starDelimiter = token.endsWith('*');
  }

  var open = <_Tag>[];
  var previous = <_Tag>[];
  for (var i = 0; i < units.length; i++) {
    final unit = units[i];
    var wanted = _emphasis(unit.attrs);
    if (whitespace(unit)) {
      // Keep common enclosing emphasis across internal spaces; delimiters must
      // not open or close immediately next to edge whitespace.
      final count = _common(
        wanted,
        previous,
      ).clamp(0, _common(wanted, nextStyles[i]));
      wanted = wanted.take(count).toList();
    } else {
      previous = List.of(wanted);
    }
    for (final entry in {'color': 'color', 'background': 'mark'}.entries) {
      final color = unit.attrs[entry.key]?.toString().toLowerCase();
      if (color != null && RegExp(r'^#[0-9a-f]{6}$').hasMatch(color)) {
        wanted.add((
          identity: '${entry.key}:$color',
          open: '[${entry.value}=$color]',
          close: '[/${entry.value}]',
        ));
      }
    }
    final common = _common(open, wanted);
    for (var j = open.length - 1; j >= common; j--) {
      delimiter(open[j].close);
    }
    for (var j = common; j < wanted.length; j++) {
      delimiter(wanted[j].open);
    }
    result.write(_escaped(unit.text));
    starDelimiter = false;
    open = wanted;
  }
  for (final tag in open.reversed) {
    delimiter(tag.close);
  }
  return result.toString();
}

class SongEditResult {
  const SongEditResult({
    required this.text,
    required this.title,
    required this.notes,
    required this.translation,
  });
  final String text, title, notes, translation;
}

class SongEditorPage extends StatefulWidget {
  const SongEditorPage({
    super.key,
    required this.song,
    required this.text,
    required this.teacher,
    required this.save,
  });
  final Song song;
  final String text;
  final bool teacher;
  final Future<void> Function(SongEditResult) save;
  @override
  State<SongEditorPage> createState() => _SongEditorPageState();
}

class _SongEditorPageState extends State<SongEditorPage> {
  late final q.QuillController _editor = q.QuillController(
    document: lyricsDocument(widget.text),
    selection: const TextSelection.collapsed(offset: 0),
  );
  late final String _originalDelta;
  late final _title = TextEditingController(text: widget.song.title);
  late final _notes = TextEditingController(
    text: widget.song.meta['notes']?.toString() ?? '',
  );
  late final _translation = TextEditingController(
    text: widget.song.meta['translation']?.toString() ?? '',
  );
  bool _saving = false;
  String? _error;
  bool get _lyricsDirty =>
      jsonEncode(_editor.document.toDelta().toJson()) != _originalDelta;
  bool get _dirty =>
      _lyricsDirty ||
      _title.text != widget.song.title ||
      _notes.text != (widget.song.meta['notes']?.toString() ?? '') ||
      _translation.text != (widget.song.meta['translation']?.toString() ?? '');

  @override
  void initState() {
    super.initState();
    _originalDelta = jsonEncode(_editor.document.toDelta().toJson());
  }

  Future<void> _save() async {
    if (_saving) return;
    if (_title.text.trim().isEmpty) {
      setState(() => _error = 'Введите название песни.');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
      _editor.readOnly = true;
    });
    try {
      await widget.save(
        SongEditResult(
          text: _lyricsDirty ? lyricsMarkup(_editor.document) : widget.text,
          title: _title.text.trim(),
          notes: _notes.text,
          translation: _translation.text,
        ),
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiFailure catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Не удалось сохранить. Проверьте интернет; черновик остаётся здесь.',
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
          _editor.readOnly = false;
        });
      }
    }
  }

  Future<void> _leave() async {
    if (_saving) return;
    if (!_dirty) {
      Navigator.pop(context);
      return;
    }
    final leave = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Есть несохранённые изменения'),
        scrollable: true,
        content: const Text(
          'Оставить черновик открытым или выйти без сохранения?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Продолжить'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Выйти без сохранения'),
          ),
        ],
      ),
    );
    if (leave == true && mounted) Navigator.pop(context);
  }

  void _toggle(q.Attribute attribute) {
    if (_saving) return;
    final active =
        _editor.getSelectionStyle().attributes[attribute.key]?.value != null;
    _editor.formatSelection(
      q.Attribute.clone(attribute, active ? null : attribute.value),
    );
  }

  Future<void> _color(bool marker) async {
    if (_saving) return;
    final selection = _editor.selection;
    final key = marker ? 'background' : 'color';
    final current = _editor
        .getSelectionStyle()
        .attributes[key]
        ?.value
        ?.toString();
    final selected = await showDialog<String>(
      context: context,
      builder: (context) => SongColorDialog(marker: marker, initial: current),
    );
    if (selected == null || !mounted || _saving) return;
    _editor.updateSelection(selection, q.ChangeSource.local);
    _editor.formatSelection(
      q.Attribute.fromKeyValue(key, selected == 'clear' ? null : selected)!,
    );
  }

  Future<void> _metadata() => showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Название, перевод и заметки'),
      scrollable: true,
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _title,
            decoration: const InputDecoration(labelText: 'Название'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _translation,
            minLines: 2,
            maxLines: 5,
            decoration: const InputDecoration(labelText: 'Перевод'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _notes,
            minLines: 2,
            maxLines: 5,
            decoration: const InputDecoration(labelText: 'Заметки'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Готово'),
        ),
      ],
    ),
  );

  Widget _toolbar() => ListenableBuilder(
    listenable: _editor,
    builder: (context, _) {
      final attrs = _editor.getSelectionStyle().attributes;
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final tool in [
              (
                attribute: q.Attribute.bold,
                tooltip: 'Жирный',
                icon: Icons.format_bold,
              ),
              (
                attribute: q.Attribute.italic,
                tooltip: 'Курсив',
                icon: Icons.format_italic,
              ),
              (
                attribute: q.Attribute.underline,
                tooltip: 'Подчёркнутый',
                icon: Icons.format_underlined,
              ),
            ])
              IconButton(
                tooltip: tool.tooltip,
                isSelected: attrs[tool.attribute.key]?.value != null,
                onPressed: _saving ? null : () => _toggle(tool.attribute),
                icon: Icon(tool.icon),
              ),
            IconButton(
              tooltip: 'Цвет букв',
              onPressed: _saving ? null : () => _color(false),
              icon: const Icon(Icons.format_color_text),
            ),
            IconButton(
              tooltip: 'Цвет маркера',
              onPressed: _saving ? null : () => _color(true),
              icon: const Icon(Icons.border_color),
            ),
            IconButton(
              tooltip: 'Отменить правку',
              onPressed: _saving ? null : _editor.undo,
              icon: const Icon(Icons.undo),
            ),
            IconButton(
              tooltip: 'Вернуть правку',
              onPressed: _saving ? null : _editor.redo,
              icon: const Icon(Icons.redo),
            ),
          ],
        ),
      );
    },
  );

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: false,
    onPopInvokedWithResult: (didPop, result) {
      if (!didPop) _leave();
    },
    child: Scaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: _saving ? null : _leave),
        title: const Text(
          'Изменить песню',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Сохраняем…' : 'Сохранить'),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            if (_error != null)
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 80),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              ),
            if (widget.teacher)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _saving ? null : _metadata,
                  icon: const Icon(Icons.edit_note),
                  label: const Text('Название, перевод и заметки'),
                ),
              ),
            _toolbar(),
            Expanded(
              child: q.QuillEditor.basic(
                controller: _editor,
                config: const q.QuillEditorConfig(
                  padding: EdgeInsets.all(20),
                  placeholder: 'Текст песни…',
                  autoFocus: false,
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  @override
  void dispose() {
    _editor.dispose();
    _title.dispose();
    _notes.dispose();
    _translation.dispose();
    super.dispose();
  }
}

/// Owns its controllers: closing/cancelling needs no delayed disposal workaround.
class SongColorDialog extends StatefulWidget {
  const SongColorDialog({super.key, required this.marker, this.initial});
  final bool marker;
  final String? initial;
  @override
  State<SongColorDialog> createState() => _SongColorDialogState();
}

class _SongColorDialogState extends State<SongColorDialog> {
  late final _hex = TextEditingController(
    text: widget.initial ?? (widget.marker ? '#fff176' : '#c62828'),
  );
  final _rgb = List.generate(3, (_) => TextEditingController());
  bool _rgbChanged = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _syncRgb();
  }

  void _syncRgb() {
    if (!RegExp(r'^#[\da-fA-F]{6}$').hasMatch(_hex.text.trim())) return;
    for (var i = 0; i < 3; i++) {
      _rgb[i].text = int.parse(
        _hex.text.trim().substring(1 + 2 * i, 3 + 2 * i),
        radix: 16,
      ).toString();
    }
  }

  void _hexChanged(String _) {
    _rgbChanged = false;
    _syncRgb();
    setState(() => _error = null);
  }

  String? _rgbColor() {
    final channels = _rgb
        .map((controller) => int.tryParse(controller.text))
        .toList();
    if (channels.any((value) => value == null || value < 0 || value > 255)) {
      return null;
    }
    return '#${channels.map((value) => value!.toRadixString(16).padLeft(2, '0')).join()}';
  }

  void _rgbEdit(String _) {
    _rgbChanged = true;
    final color = _rgbColor();
    if (color != null) _hex.text = color;
    setState(() => _error = null);
  }

  void _apply() {
    final color = _rgbChanged ? _rgbColor() : _hex.text.trim().toLowerCase();
    if (color == null || !RegExp(r'^#[\da-f]{6}$').hasMatch(color)) {
      setState(
        () => _error = _rgbChanged
            ? 'Каждый канал RGB: от 0 до 255.'
            : 'Введите цвет в формате #RRGGBB.',
      );
      return;
    }
    Navigator.pop(context, color);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.marker ? 'Цвет маркера' : 'Цвет букв'),
    insetPadding: const EdgeInsets.all(12),
    scrollable: true,
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Wrap(
          spacing: 4,
          runSpacing: 4,
          children: [
            for (final color
                in widget.marker
                    ? [
                        '#fff176',
                        '#a5d6a7',
                        '#90caf9',
                        '#f8bbd0',
                        '#ce93d8',
                        '#ffcc80',
                        '#80cbc4',
                        '#e6ee9c',
                      ]
                    : [
                        '#c62828',
                        '#1565c0',
                        '#2e7d32',
                        '#7b1fa2',
                        '#d84315',
                        '#00796b',
                        '#ad1457',
                        '#3949ab',
                        '#795548',
                        '#616161',
                      ])
              IconButton(
                tooltip: 'Выбрать цвет $color',
                onPressed: () => Navigator.pop(context, color),
                icon: DecoratedBox(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Color(
                      0xff000000 | int.parse(color.substring(1), radix: 16),
                    ),
                  ),
                  child: const SizedBox(width: 28, height: 28),
                ),
              ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _hex,
          onChanged: _hexChanged,
          maxLength: 7,
          autocorrect: false,
          decoration: const InputDecoration(labelText: 'HEX: #RRGGBB'),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (var i = 0; i < 3; i++)
              SizedBox(
                width: 68,
                child: TextField(
                  controller: _rgb[i],
                  onChanged: _rgbEdit,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  maxLength: 3,
                  decoration: InputDecoration(
                    labelText: ['R', 'G', 'B'][i],
                    counterText: '',
                  ),
                ),
              ),
          ],
        ),
        if (_error != null)
          Text(
            _error!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
      ],
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context, 'clear'),
        child: const Text('Обычный'),
      ),
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Отмена'),
      ),
      TextButton(onPressed: _apply, child: const Text('Применить')),
    ],
  );
  @override
  void dispose() {
    _hex.dispose();
    for (final controller in _rgb) {
      controller.dispose();
    }
    super.dispose();
  }
}
