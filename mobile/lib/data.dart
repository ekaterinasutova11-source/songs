import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:unorm_dart/unorm_dart.dart' as unorm;

const serverOrigin = 'https://135.106.183.211';
String buildFileName(String title, String kind, String label, String ext) {
  final suffix = label.trim();
  if (kind == 'orig') {
    return '${title.trim()} (${suffix.isEmpty ? 'оригинал' : suffix})$ext';
  }
  return '${title.trim()} ${kind == 'plus' ? '+' : '-'}${suffix.isEmpty ? '' : ' ($suffix)'}$ext';
}

/// A personal link's route. Never includes the original URL in diagnostics.
class Session {
  const Session({
    required this.key,
    required this.mode,
    this.folder,
    this.song,
    this.archive = false,
  });
  final String key;
  final String mode;
  final String? folder;
  final String? song;
  final bool archive;
  bool get isTeacher => mode == 't';

  factory Session.parse(String input) {
    const message = 'Вставьте личную ссылку Songs целиком.';
    try {
      // Uri.parse repairs malformed percent escapes; the website rejects them.
      if (RegExp(r'%(?![0-9a-fA-F]{2})').hasMatch(input)) {
        throw const FormatException(message);
      }
      final uri = Uri.parse(input.trim());
      final trusted =
          uri.scheme == 'https' &&
          uri.userInfo.isEmpty &&
          (!uri.hasPort || uri.port == 443) &&
          ((uri.host == '135.106.183.211' &&
                  (uri.path.isEmpty || uri.path == '/')) ||
              (uri.host == 'ekaterinasutova11-source.github.io' &&
                  (uri.path == '/songs/' || uri.path == '/songs')));
      if (!trusted) throw const FormatException(message);
      final route = uri.fragment.replaceFirst(RegExp(r'^/?'), '');
      final archive = RegExp(r'^t/([\w-]{8,})/archive$').firstMatch(route);
      if (archive != null) {
        return Session(key: archive[1]!, mode: 't', archive: true);
      }
      final match = RegExp(
        r'^([ts])/([\w-]{8,})(?:/(s|space)/([^/]+))?(?:/song/([^/]+))?$',
      ).firstMatch(route);
      if (match == null ||
          (match[1] == 's' && match[3] == 's') ||
          (match[1] == 't' && match[3] == 'space')) {
        throw const FormatException(message);
      }
      return Session(
        key: match[2]!,
        mode: match[1]!,
        folder: match[4] == null ? null : Uri.decodeComponent(match[4]!),
        song: match[5] == null ? null : Uri.decodeComponent(match[5]!),
      );
    } catch (_) {
      throw const FormatException(message);
    }
  }

  Map<String, dynamic> toJson() => {
    'key': key,
    'mode': mode,
    if (folder != null) 'folder': folder,
    if (song != null) 'song': song,
    if (archive) 'archive': true,
  };
  factory Session.fromJson(Map<String, dynamic> json) {
    final key = json['key'];
    final mode = json['mode'];
    final folder = json['folder'];
    final song = json['song'];
    if (key is! String ||
        !RegExp(r'^[\w-]{8,}$').hasMatch(key) ||
        (mode != 't' && mode != 's') ||
        (folder != null && folder is! String) ||
        (song != null && song is! String) ||
        (mode == 's' && json['archive'] == true)) {
      throw const FormatException('Сохранённая ссылка недействительна.');
    }
    return Session(
      key: key,
      mode: mode as String,
      folder: folder as String?,
      song: song as String?,
      archive: json['archive'] == true,
    );
  }
}

class SongFile {
  const SongFile({required this.name, this.size = 0, this.modified = ''});
  final String name;
  final int size;
  final String modified;
  factory SongFile.fromJson(Map<String, dynamic> json) => SongFile(
    name: json['name'] as String,
    size: (json['size'] as num?)?.toInt() ?? 0,
    modified: json['modified'] as String? ?? '',
  );
}

class ParsedFileName {
  const ParsedFileName(this.title, this.kind, this.label);
  final String title;
  final String kind;
  final String label;
}

String songKey(String title) => unorm
    .nfd(title.toLowerCase().replaceAll('ё', 'е'))
    .replaceAll(RegExp(r'[\u0300-\u036f]'), '')
    .replaceAll(RegExp('[’\'`]'), "'")
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

ParsedFileName parseFileName(String fileName) {
  final base = fileName.replaceFirst(RegExp(r'\.[^.]+$'), '').trim();
  var depth = 0;
  var found = -1;
  for (var i = 0; i < base.length; i++) {
    final c = base[i];
    if (c == '(') {
      depth++;
    } else if (c == ')') {
      if (depth > 0) depth--;
    } else if (depth == 0 && '+-−–'.contains(c)) {
      if (i + 1 == base.length || base[i + 1] == ' ' || base[i + 1] == '(') {
        found = i;
      }
    }
  }
  if (found >= 0) {
    final title = base.substring(0, found).trim();
    var label = base.substring(found + 1).trim();
    if (label.startsWith('(') && label.endsWith(')')) {
      label = label.substring(1, label.length - 1).trim();
    }
    return ParsedFileName(
      title.isEmpty ? base : title,
      base[found] == '+' ? 'plus' : 'minus',
      label,
    );
  }
  final match = RegExp(r'^(.*?)\s*\(([^()]*)\)\s*$').firstMatch(base);
  if (match != null && match[1]!.isNotEmpty) {
    return ParsedFileName(match[1]!.trim(), 'orig', match[2]!.trim());
  }
  return ParsedFileName(base, 'orig', '');
}

class AudioVariant {
  const AudioVariant({
    required this.kind,
    required this.label,
    required this.file,
  });
  final String kind;
  final String label;
  final SongFile file;
  String get displayName {
    final name = {'minus': 'Минус', 'plus': 'Плюс', 'orig': 'Оригинал'}[kind]!;
    return label.isEmpty || (kind == 'orig' && songKey(label) == 'оригинал')
        ? name
        : '$name · $label';
  }
}

class Song {
  const Song({
    required this.key,
    required this.title,
    required this.variants,
    this.lyricsFile,
    this.meta = const {},
    this.modified = '',
  });
  final String key;
  final String title;
  final List<AudioVariant> variants;
  final SongFile? lyricsFile;
  final Map<String, dynamic> meta;
  final String modified;
}

final _audioExt = RegExp(
  r'\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm)$',
  caseSensitive: false,
);
final _lyricsExt = RegExp(r'\.txt$', caseSensitive: false);
int _capitals(String text) => text.runes.where((rune) {
  final c = String.fromCharCode(rune);
  return c.toUpperCase() == c && c.toLowerCase() != c;
}).length;

// Dart's core comparator has no locale collation. Keep Russian labels in
// alphabetic order (including ё), with the same kind/empty-label precedence.
String _labelOrder(String value) =>
    value.toLowerCase().replaceAll('ё', 'е\u0001');

List<Song> groupSongs(
  List<SongFile> files, {
  Map<String, dynamic> meta = const {},
}) {
  final titles = <String, String>{};
  final variants = <String, List<AudioVariant>>{};
  final modified = <String, String>{};
  final lyrics = <String, SongFile>{};
  for (final file in files) {
    if (_lyricsExt.hasMatch(file.name)) {
      lyrics[songKey(file.name.replaceFirst(_lyricsExt, '').trim())] = file;
    } else if (_audioExt.hasMatch(file.name)) {
      final parsed = parseFileName(file.name);
      final key = songKey(parsed.title);
      if (!titles.containsKey(key) ||
          _capitals(parsed.title) > _capitals(titles[key]!)) {
        titles[key] = parsed.title;
      }
      (variants[key] ??= []).add(
        AudioVariant(kind: parsed.kind, label: parsed.label, file: file),
      );
      if (file.modified.compareTo(modified[key] ?? '') > 0) {
        modified[key] = file.modified;
      }
    }
  }
  for (final entry in lyrics.entries) {
    if (!titles.containsKey(entry.key)) {
      titles[entry.key] = entry.value.name.replaceFirst(_lyricsExt, '').trim();
      modified[entry.key] = entry.value.modified;
    }
  }
  const order = {'minus': 0, 'plus': 1, 'orig': 2};
  return titles.entries
      .map((entry) {
        final audio = variants[entry.key] ?? <AudioVariant>[];
        audio.sort((a, b) {
          final kind = order[a.kind]!.compareTo(order[b.kind]!);
          if (kind != 0) return kind;
          if (a.label.isEmpty != b.label.isEmpty) {
            return a.label.isEmpty ? -1 : 1;
          }
          return _labelOrder(a.label).compareTo(_labelOrder(b.label));
        });
        final songMeta = meta[entry.key];
        return Song(
          key: entry.key,
          title: entry.value,
          variants: List.unmodifiable(audio),
          lyricsFile: lyrics[entry.key],
          modified: modified[entry.key] ?? '',
          meta: songMeta is Map
              ? Map<String, dynamic>.from(songMeta)
              : const {},
        );
      })
      .toList(growable: false);
}

class Student {
  Student({
    required this.id,
    required this.name,
    this.kind = 'individual',
    this.archivedAt,
    this.files = const [],
    this.meta = const {},
  }) : songs = groupSongs(files, meta: meta);
  final String id;
  final String name;
  final String kind;
  String get kindLabel => switch (kind) {
    'duet' => 'Дуэт',
    'ensemble' => 'Ансамбль',
    _ => 'Личное',
  };
  final String? archivedAt;
  final List<SongFile> files;
  final Map<String, dynamic> meta;
  final List<Song> songs;
  bool get isArchived => archivedAt != null && archivedAt!.isNotEmpty;
  factory Student.fromJson(Map<String, dynamic> json) => Student(
    id: json['id'] as String,
    name: json['name'] as String,
    kind: json['kind'] as String? ?? 'individual',
    archivedAt: json['archivedAt'] as String?,
    files: (json['files'] as List? ?? [])
        .map(
          (file) => SongFile.fromJson(Map<String, dynamic>.from(file as Map)),
        )
        .toList(growable: false),
    meta: Map<String, dynamic>.from(json['meta'] as Map? ?? {}),
  );
}

class Library {
  const Library({required this.role, required this.students, this.ownId});
  final String role;
  final List<Student> students;
  final String? ownId;
  String? get personalSpaceId => ownId ?? students.firstOrNull?.id;
  factory Library.fromJson(Map<String, dynamic> json) => Library(
    role: json['role'] as String,
    ownId: json['ownId'] as String?,
    students: (json['students'] as List)
        .map(
          (student) =>
              Student.fromJson(Map<String, dynamic>.from(student as Map)),
        )
        .toList(growable: false),
  );
}

class ApiFailure implements Exception {
  const ApiFailure(this.status, this.message);
  final int status;
  final String message;
  @override
  String toString() => message;
}

ApiFailure _httpFailure(int status) => ApiFailure(status, switch (status) {
  401 || 403 =>
    'Доступ закрыт или ссылка недействительна. Обратитесь к преподавателю.',
  404 => 'Материал больше не найден. Обновите список песен.',
  400 => 'Проверьте введённые данные и название.',
  409 => 'Материалы уже изменились или такое название существует. Обновите список перед повтором.',
  _ => 'Сервер временно недоступен. Попробуйте ещё раз.',
});

class SongsApi {
  SongsApi({http.Client? client}) : _client = client ?? http.Client();
  final http.Client _client;
  static const _timeout = Duration(seconds: 25);

  Future<http.Response> _send(http.Request request) async {
    request.followRedirects = false;
    try {
      return await (() async {
        final response = await _client.send(request);
        return http.Response.fromStream(response);
      })().timeout(_timeout);
    } on TimeoutException {
      throw const ApiFailure(
        0,
        'Сервер не ответил вовремя. Проверьте подключение.',
      );
    } catch (_) {
      throw const ApiFailure(0, 'Не удалось подключиться. Проверьте интернет.');
    }
  }

  Future<Map<String, dynamic>> _call(
    Session session,
    String action, [
    Map<String, dynamic> params = const {},
  ]) async {
    final request = http.Request('POST', Uri.parse('$serverOrigin/api'))
      ..headers['Content-Type'] = 'text/plain; charset=utf-8'
      ..body = jsonEncode({'action': action, 'key': session.key, ...params});
    final response = await _send(request);
    if (response.statusCode != 200) throw _httpFailure(response.statusCode);
    try {
      final json = jsonDecode(utf8.decode(response.bodyBytes));
      if (json is! Map<String, dynamic> || json.containsKey('error')) {
        throw const FormatException();
      }
      return json;
    } catch (_) {
      throw const ApiFailure(
        502,
        'Сервер вернул непонятный ответ. Попробуйте ещё раз.',
      );
    }
  }

  Future<Library> library(Session session) async {
    final json = await _call(session, 'library', {'includeSpaces': true});
    try {
      final library = Library.fromJson(json);
      if (library.role != (session.isTeacher ? 'teacher' : 'student')) {
        throw const FormatException();
      }
      if (!session.isTeacher) {
        final ownId = library.personalSpaceId;
        if (library.students.isEmpty ||
            (library.students.length > 1 && library.ownId == null) ||
            !library.students.any((space) => space.id == ownId) ||
            library.students.map((space) => space.id).toSet().length !=
                library.students.length ||
            library.students.any(
              (space) =>
                  !['individual', 'duet', 'ensemble'].contains(space.kind) ||
                  (space.kind == 'individual' && space.id != ownId),
            )) {
          throw const FormatException();
        }
      }
      return library;
    } catch (_) {
      throw const ApiFailure(
        502,
        'Не удалось прочитать библиотеку. Обновите страницу.',
      );
    }
  }

  Future<void> createStudent(Session session, String name) async {
    if (!session.isTeacher) {
      throw const ApiFailure(
        403,
        'Добавлять учеников может только преподаватель.',
      );
    }
    final trimmed = name.trim();
    if (trimmed.isEmpty ||
        trimmed.length > 200 ||
        RegExp(r'[\\/\x00-\x1f]').hasMatch(trimmed)) {
      throw const ApiFailure(
        400,
        'Введите имя без слешей и переносов строк (до 200 знаков).',
      );
    }
    await _call(session, 'createStudent', {'name': trimmed});
  }

  Future<void> saveLyrics(
    Session session,
    String folder,
    String name,
    String text,
    String? modified,
  ) async {
    await _call(session, 'saveLyrics', {
      'folder': folder,
      'name': name,
      'text': text,
      'expectedModified': modified,
    });
  }

  Future<void> editSong(
    Session session,
    String folder,
    String song,
    Map<String, dynamic> edits,
  ) async {
    await _call(session, 'editSong', {
      'folder': folder,
      'song': song,
      ...edits,
    });
  }

  Future<void> saveTimings(
    Session session,
    String folder,
    String song,
    Map<String, dynamic>? timings,
  ) async {
    await _call(session, 'saveTimings', {
      'folder': folder,
      'song': song,
      'timings': timings,
    });
  }

  Future<void> teacherAction(
    Session session,
    String action,
    Map<String, dynamic> params,
  ) async {
    if (!session.isTeacher) {
      throw const ApiFailure(403, 'Это действие доступно преподавателю.');
    }
    await _call(session, action, params);
  }

  Future<Uint8List> download(
    Session session,
    String folder,
    SongFile file,
  ) async {
    final uri = await mediaUrl(session, folder, file.name);
    final request = http.Request('GET', uri)..followRedirects = false;
    final response = await _client
        .send(request)
        .timeout(const Duration(seconds: 30));
    if (response.statusCode != 200) throw _httpFailure(response.statusCode);
    if ((response.contentLength ?? 0) > 268435456) {
      throw const ApiFailure(413, 'Файл слишком большой для скачивания.');
    }
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in response.stream.timeout(
      const Duration(seconds: 60),
    )) {
      if (bytes.length + chunk.length > 268435456) {
        throw const ApiFailure(413, 'Файл слишком большой для скачивания.');
      }
      bytes.add(chunk);
    }
    final result = bytes.takeBytes();
    if (file.size > 0 && result.length != file.size) {
      throw const ApiFailure(
        409,
        'Запись изменилась. Обновите материалы и скачайте заново.',
      );
    }
    return result;
  }

  Future<void> upload(
    Session session,
    String folder,
    String name,
    Uint8List bytes, {
    bool overwrite = false,
    bool Function()? canContinue,
  }) async {
    if (canContinue?.call() == false) {
      throw const ApiFailure(403, 'Вход изменился.');
    }
    if (!session.isTeacher) {
      throw const ApiFailure(403, 'Аудиофайлы меняет преподаватель.');
    }
    if (bytes.isEmpty || bytes.length > 268435456) {
      throw const ApiFailure(413, 'Допустим файл до 256 МБ.');
    }
    final ticket = await _call(session, 'uploadUrl', {
      'folder': folder,
      'name': name,
      'overwrite': overwrite,
    });
    if (canContinue?.call() == false) {
      throw const ApiFailure(403, 'Вход изменился.');
    }
    final uri = Uri.tryParse(ticket['href'] as String? ?? '');
    if (uri == null ||
        uri.origin != serverOrigin ||
        uri.path != '/upload' ||
        uri.userInfo.isNotEmpty) {
      throw const ApiFailure(
        502,
        'Не удалось получить безопасный адрес загрузки.',
      );
    }
    final request = http.Request('PUT', uri)
      ..followRedirects = false
      ..bodyBytes = bytes;
    final response = await _client
        .send(request)
        .timeout(const Duration(minutes: 3));
    await response.stream.drain<void>();
    if (response.statusCode != 200) throw _httpFailure(response.statusCode);
  }

  Future<Uri> mediaUrl(Session session, String folder, String name) async {
    final json = await _call(session, 'url', {'folder': folder, 'name': name});
    final uri = json['href'] is String
        ? Uri.tryParse(json['href'] as String)
        : null;
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host != '135.106.183.211' ||
        (uri.hasPort && uri.port != 443) ||
        uri.userInfo.isNotEmpty ||
        uri.path != '/media' ||
        uri.fragment.isNotEmpty ||
        uri.queryParameters['token']?.isNotEmpty != true) {
      throw const ApiFailure(
        502,
        'Не удалось получить безопасную ссылку на материал.',
      );
    }
    return uri;
  }

  Future<String> lyrics(Session session, String folder, SongFile file) async {
    final uri = await mediaUrl(session, folder, file.name);
    final response = await _send(http.Request('GET', uri));
    if (response.statusCode != 200) throw _httpFailure(response.statusCode);
    if (response.bodyBytes.length > 1048576) {
      throw const ApiFailure(413, 'Текст слишком большой для просмотра.');
    }
    try {
      return utf8.decode(response.bodyBytes).replaceFirst('\ufeff', '');
    } catch (_) {
      throw const ApiFailure(502, 'Не удалось прочитать текст.');
    }
  }

  void close() => _client.close();
}
