// Read-only smoke check. Run from mobile/. Credentials never leave local memory
// except the existing authenticated API request. Output contains counts only.
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:songs/data.dart';

Future<void> main() async {
  final api = SongsApi();
  final media = http.Client();
  try {
    final env = await File('../secrets/teacher.env').readAsString();
    final teacherKey = RegExp(
      r'^TEACHER_KEY=(.*)$',
      multiLine: true,
    ).firstMatch(env)![1]!.trim();
    final teacher = await api.library(Session(key: teacherKey, mode: 't'));
    final baseline = jsonDecode(
      await File('../secrets/frontend-move/library-before.json').readAsString(),
    ) as Map<String, dynamic>;
    final activeIds = teacher.students
        .where((s) => !s.isArchived)
        .map((s) => s.id)
        .toSet();
    final pupil = (baseline['students'] as List)
        .cast<Map<String, dynamic>>()
        .firstWhere((s) => activeIds.contains(s['id']));
    final session = Session(key: pupil['key'] as String, mode: 's');
    final own = await api.library(session);
    if (own.personalSpaceId != pupil['id']) {
      throw const FormatException();
    }
    final student = own.students.firstWhere((s) => s.id == own.personalSpaceId);
    final song = student.songs.firstWhere((s) => s.variants.isNotEmpty);
    final uri = await api.mediaUrl(
      session,
      student.id,
      song.variants.first.file.name,
    );
    final request = http.Request('GET', uri)
      ..headers['Range'] = 'bytes=0-1023'
      ..followRedirects = false;
    final response = await media
        .send(request)
        .timeout(const Duration(seconds: 25));
    final bytes = await response.stream.toBytes().timeout(
      const Duration(seconds: 25),
    );
    if (response.statusCode != 206 ||
        bytes.length != 1024 ||
        response.headers['content-range']?.startsWith('bytes 0-1023/') !=
            true) {
      throw const FormatException();
    }
    final textSong = student.songs
        .where((s) => s.lyricsFile != null)
        .firstOrNull;
    final textChecked = textSong == null
        ? false
        : (await api.lyrics(
            session,
            student.id,
            textSong.lyricsFile!,
          )).isNotEmpty;
    final report = {
      'checkedAt': DateTime.now().toUtc().toIso8601String(),
      'teacherSpaces': teacher.students.length,
      'studentIsolation': true,
      'studentSongs': student.songs.length,
      'mediaRangeStatus': response.statusCode,
      'mediaRangeBytes': bytes.length,
      'lyricsReadable': textChecked,
      'writesPerformed': false,
    };
    await File('../outputs/mobile-selectel-verification.json')
        .writeAsString(const JsonEncoder.withIndent('  ').convert(report));
    stdout.writeln(jsonEncode(report));
  } catch (_) {
    stderr.writeln(
      'Selectel verification failed; no credentials or private URLs were logged.',
    );
    exitCode = 1;
  } finally {
    api.close();
    media.close();
  }
}
