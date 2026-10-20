import 'package:flutter/material.dart';

// Read the existing TXT syntax from lyrics.js. No HTML evaluation or rewriting.
class LyricRun {
  LyricRun(
    this.text,
    this.bold,
    this.italic,
    this.underline,
    this.marked,
    this.color, [
    this.highlight,
  ]);
  String text;
  final bool bold, italic, underline, marked;
  final String? color;
  final String? highlight;
  bool sameStyle(LyricRun other) =>
      bold == other.bold &&
      italic == other.italic &&
      underline == other.underline &&
      marked == other.marked &&
      color == other.color &&
      highlight == other.highlight;
}

List<LyricRun> parseLyrics(String markup) {
  final token = RegExp(
    r'\\([\s\S])|\*\*|\*|__|==|\[(\/?)(red|blue|green|purple|color(?:=#[\da-fA-F]{6})?|mark(?:=#[\da-fA-F]{6})?)\]|[^\\*_=\[]+|[\s\S]',
  );
  final tokens = token.allMatches(markup).toList();
  final runs = <LyricRun>[];
  var bold = false, italic = false, underline = false, marked = false;
  String? color;
  String? highlight;
  final colors = <({String tag, String? previous})>[];
  final highlights = <String?>[];
  bool whitespace(String text) => RegExp(r'\s').hasMatch(text);
  bool canClose(int index) => !whitespace(
    tokens[index].start > 0 ? markup[tokens[index].start - 1] : ' ',
  );
  bool canOpen(int index) {
    final end = tokens[index].end;
    if (whitespace(end < markup.length ? markup[end] : ' ')) return false;
    for (var j = index + 1; j < tokens.length; j++) {
      if (tokens[j][0] == tokens[index][0] && canClose(j)) return true;
    }
    return false;
  }

  void push(String text) {
    final run = LyricRun(
      text,
      bold,
      italic,
      underline,
      marked,
      color,
      highlight,
    );
    if (runs.isNotEmpty && runs.last.sameStyle(run)) {
      runs.last.text += text;
    } else {
      runs.add(run);
    }
  }

  for (var index = 0; index < tokens.length; index++) {
    final match = tokens[index];
    final text = match[0]!;
    if (match[1] != null) {
      push(match[1]!);
      continue;
    }
    final state = switch (text) {
      '**' => bold,
      '*' => italic,
      '__' => underline,
      '==' => marked,
      _ => null,
    };
    if (state != null &&
        ((state && canClose(index)) || (!state && canOpen(index)))) {
      switch (text) {
        case '**':
          bold = !bold;
        case '*':
          italic = !italic;
        case '__':
          underline = !underline;
        case '==':
          marked = !marked;
      }
    } else if (match[3] != null &&
        match[2] == '' &&
        (const ['red', 'blue', 'green', 'purple'].contains(match[3]) ||
            match[3]!.startsWith('color='))) {
      final tag = match[3]!;
      colors.add((
        tag: tag.startsWith('color=') ? 'color' : tag,
        previous: color,
      ));
      color = tag.startsWith('color=') ? tag.substring(6).toLowerCase() : tag;
    } else if (match[3] != null &&
        match[2] == '/' &&
        colors.isNotEmpty &&
        colors.last.tag == match[3]) {
      color = colors.removeLast().previous;
    } else if (match[3]?.startsWith('mark=') == true && match[2] == '') {
      highlights.add(highlight);
      highlight = match[3]!.substring(5).toLowerCase();
    } else if (match[3] == 'mark' && match[2] == '/' && highlights.isNotEmpty) {
      highlight = highlights.removeLast();
    } else {
      push(text);
    }
  }
  return runs;
}

class FormattedLyrics extends StatelessWidget {
  const FormattedLyrics(this.text, {super.key, this.style});
  final String text;
  final TextStyle? style;
  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final palette = dark
        ? {
            'red': const Color(0xffff8a80),
            'blue': const Color(0xff82b1ff),
            'green': const Color(0xff9ccc65),
            'purple': const Color(0xffce93d8),
          }
        : {
            'red': const Color(0xffc62828),
            'blue': const Color(0xff1565c0),
            'green': const Color(0xff2e7d32),
            'purple': const Color(0xff7b1fa2),
          };
    Color? customColor(String? hex) {
      if (hex == null || !RegExp(r'^#[\da-f]{6}$').hasMatch(hex)) return null;
      return Color(0xff000000 | int.parse(hex.substring(1), radix: 16));
    }

    return SelectableText.rich(
      TextSpan(
        children: [
          for (final run in parseLyrics(text))
            TextSpan(
              text: run.text,
              style: TextStyle(
                fontWeight: run.bold
                    ? FontWeight.w700
                    : style?.fontWeight ?? FontWeight.w400,
                fontStyle: run.italic ? FontStyle.italic : FontStyle.normal,
                decoration: run.underline
                    ? TextDecoration.underline
                    : TextDecoration.none,
                backgroundColor:
                    customColor(run.highlight) ??
                    (run.marked ? Color(dark ? 0xff6b5d12 : 0xfffff176) : null),
                color: customColor(run.color) ?? palette[run.color],
              ),
            ),
        ],
      ),
      style: const TextStyle(height: 1.9, fontSize: 16).merge(style),
    );
  }
}
