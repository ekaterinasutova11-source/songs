import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:just_audio_background/just_audio_background.dart';

import 'data.dart';
import 'player.dart';
import 'brand.dart';
import 'lyrics.dart';
import 'ui_settings.dart';
import 'add_student.dart';
import 'metronome.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await JustAudioBackground.init(
    androidNotificationChannelId: 'ru.sadzvuka.songs.audio',
    androidNotificationChannelName: 'Музыка для занятий',
    androidNotificationOngoing: true,
    androidNotificationIcon: 'drawable/ic_stat_songs',
  );
  runApp(const SongsApp());
}

abstract interface class SessionStore {
  Future<Session?> read();
  Future<void> save(Session session);
  Future<void> clear();
}

class SecureSessionStore implements SessionStore {
  static const _storage = FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );
  static const _name = 'songs.session.v1';
  @override
  Future<Session?> read() async {
    final value = await _storage.read(key: _name);
    if (value == null) return null;
    try {
      final json = jsonDecode(value);
      if (json is! Map<String, dynamic>) throw const FormatException();
      return Session.fromJson(json);
    } on FormatException {
      await clear();
      return null;
    }
  }

  @override
  Future<void> save(Session session) =>
      _storage.write(key: _name, value: jsonEncode(session.toJson()));
  @override
  Future<void> clear() => _storage.delete(key: _name);
}

class SongsApp extends StatefulWidget {
  const SongsApp({super.key, this.api, this.store, this.uiStore});
  final SongsApi? api;
  final SessionStore? store;
  final UiSettingsStore? uiStore;
  @override
  State<SongsApp> createState() => _SongsAppState();
}

class _SongsAppState extends State<SongsApp> {
  late final _settings = UiSettingsController(
    widget.uiStore ?? SecureUiSettingsStore(),
  );
  @override
  void initState() {
    super.initState();
    unawaited(_settings.load());
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Сад звука',
      debugShowCheckedModeBanner: false,
      theme: gardenTheme(Brightness.light),
      darkTheme: gardenTheme(Brightness.dark),
      builder: (context, child) => UiSettingsScope(
        controller: _settings,
        child: ListenableBuilder(
          listenable: _settings,
          builder: (context, _) =>
              ScaledInterface(scale: _settings.scale, child: child!),
        ),
      ),
      home: LibraryHome(api: widget.api, store: widget.store),
    );
  }

  @override
  void dispose() {
    _settings.dispose();
    super.dispose();
  }
}

class LibraryHome extends StatefulWidget {
  const LibraryHome({super.key, this.api, this.store});
  final SongsApi? api;
  final SessionStore? store;
  @override
  State<LibraryHome> createState() => _LibraryHomeState();
}

class _LibraryHomeState extends State<LibraryHome> with WidgetsBindingObserver {
  late final SongsApi _api = widget.api ?? SongsApi();
  late final SessionStore _store = widget.store ?? SecureSessionStore();
  late final PlayerController _player = PlayerController(
    onAccessDenied: _mediaDenied,
  );
  final _link = TextEditingController();
  Session? _session;
  Library? _library;
  String? _studentId, _songId, _error, _lyrics;
  String _query = '';
  bool _loading = true, _refreshing = false, _remember = true;
  bool _archive = false, _blocked = false, _lyricsLoading = false;
  int _epoch = 0, _textEpoch = 0;
  Future<void> _storeOperations = Future<void>.value();
  Timer? _timer;
  Student? get _student =>
      _library?.students.where((s) => s.id == _studentId).firstOrNull;
  Song? get _song => _student?.songs.where((s) => s.key == _songId).firstOrNull;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_restore());
    _timer = Timer.periodic(const Duration(seconds: 60), (_) {
      if (_session != null && !_refreshing && !_loading) {
        unawaited(_refresh(quiet: true));
      }
    });
  }

  Future<void> _restore() async {
    final epoch = _epoch;
    try {
      final session = await _store.read();
      if (!mounted || epoch != _epoch) return;
      if (session != null) {
        _setSession(session);
        await _refresh();
      }
    } catch (_) {
      if (mounted && epoch == _epoch) {
        _error = 'Не удалось открыть сохранённый вход. Вставьте личную ссылку заново.';
      }
    } finally {
      if (mounted && (epoch == _epoch || _blocked)) {
        setState(() => _loading = false);
      }
    }
  }

  void _setSession(Session session) {
    _session = session;
    _studentId = session.folder;
    _songId = session.song;
    _archive = session.archive;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        _session != null &&
        !_refreshing) {
      unawaited(_refresh(quiet: true));
    }
  }

  Future<void> _login() async {
    if (_loading) return;
    Session session;
    try {
      session = Session.parse(_link.text);
    } on FormatException {
      setState(
        () => _error =
            'Вставьте личную ссылку на «Сад звука», которую дал преподаватель.',
      );
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();
    final epoch = ++_epoch;
    setState(() {
      _setSession(session);
      _loading = true;
      _error = null;
    });
    _link.clear();
    await _refresh();
    if (!mounted || epoch != _epoch) {
      if (mounted && _blocked) setState(() => _loading = false);
      return;
    }
    if (_library != null) {
      try {
        await _changeStore(() async {
          if (!mounted || epoch != _epoch) return;
          if (_remember) {
            await _store.save(session);
          } else {
            await _store.clear();
          }
        });
      } catch (_) {
        if (mounted) {
          _message('Вход открыт, но сохранить его на устройстве не удалось.');
        }
      }
    }
    if (mounted && epoch == _epoch) setState(() => _loading = false);
  }

  Future<void> _changeStore(Future<void> Function() action) {
    final next = _storeOperations.then((_) => action());
    _storeOperations = next.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return next;
  }

  Future<void> _refresh({bool quiet = false}) async {
    final session = _session;
    if (session == null || _refreshing) return;
    final epoch = _epoch;
    _refreshing = true;
    if (!quiet && mounted) setState(() => _error = null);
    try {
      final library = await _api.library(session);
      if (!mounted || epoch != _epoch) return;
      final previousSong = _songId;
      final previousSpace = _studentId;
      var spaceRemoved = false;
      setState(() {
        _library = library;
        _blocked = false;
        _error = null;
        if (!session.isTeacher && _studentId == null) {
          _studentId = library.personalSpaceId;
        }
        if (_studentId != null &&
            !library.students.any((s) => s.id == _studentId)) {
          spaceRemoved = true;
          _studentId = session.isTeacher ? null : library.personalSpaceId;
          _songId = null;
        }
        if (spaceRemoved || previousSpace != _studentId) {
          _textEpoch++;
          _lyrics = null;
          _lyricsLoading = false;
        }
        if (_songId != null &&
            !(_student?.songs.any((s) => s.key == _songId) ?? false)) {
          _songId = null;
        }
      });
      if (spaceRemoved || (previousSong != null && _songId == null)) {
        await _player.stop();
      }
      if (!mounted || epoch != _epoch) return;
      if (_song != null && _lyrics == null && !_lyricsLoading) {
        unawaited(_loadLyrics());
      }
    } on ApiFailure catch (failure) {
      if (mounted && epoch == _epoch) _failure(failure, quiet: quiet);
    } catch (_) {
      if (mounted && epoch == _epoch && (!quiet || _library == null)) {
        setState(
          () => _error =
              'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
        );
      }
    } finally {
      if (epoch == _epoch) _refreshing = false;
    }
  }

  void _deny() {
    if (!mounted) return;
    _epoch++;
    _refreshing = false;
    unawaited(_player.stop());
    _textEpoch++;
    setState(() {
      _library = null;
      _lyrics = null;
      _lyricsLoading = false;
      _blocked = true;
      _loading = false;
      _error = 'Доступ к материалам закрыт. Обратитесь к преподавателю. Материалы сохраняются.';
    });
  }

  // A removed membership must not sign the pupil out of personal materials.
  // Rechecking the library still blocks an archived/invalid personal key.
  void _mediaDenied() {
    if (!mounted) return;
    if (_session?.isTeacher != false ||
        _studentId == _library?.personalSpaceId) {
      _deny();
      return;
    }
    _epoch++;
    _textEpoch++;
    _refreshing = false;
    unawaited(_player.stop());
    setState(() {
      _studentId = _library?.personalSpaceId;
      _songId = null;
      _lyrics = null;
      _lyricsLoading = false;
      _error = 'Доступ к общему пространству изменился. Обновляем материалы.';
    });
    unawaited(_refresh(quiet: true));
  }

  void _selectSpace(String id) {
    if (_studentId == id ||
        !(_library?.students.any((space) => space.id == id) ?? false)) {
      return;
    }
    _textEpoch++;
    unawaited(_player.stop());
    setState(() {
      _studentId = id;
      _songId = null;
      _lyrics = null;
      _lyricsLoading = false;
      _query = '';
      _error = null;
    });
  }

  void _failure(ApiFailure failure, {bool quiet = false}) {
    if (failure.status == 401 || failure.status == 403) {
      _deny();
    } else if (!quiet || _library == null) {
      setState(() => _error = failure.message);
    }
  }

  Future<void> _logout() async {
    final epoch = ++_epoch;
    _textEpoch++;
    setState(() {
      _session = null;
      _library = null;
      _studentId = null;
      _songId = null;
      _lyrics = null;
      _lyricsLoading = false;
      _refreshing = false;
      _blocked = false;
      _loading = true;
      _error = null;
      _query = '';
    });
    unawaited(_player.stop());
    String? error;
    try {
      await _changeStore(_store.clear);
    } catch (_) {
      error = 'Не удалось удалить сохранённый вход. Повторите выход при следующем запуске.';
    }
    if (mounted && epoch == _epoch) {
      setState(() {
        _loading = false;
        _error = error;
      });
    }
  }

  Future<void> _loadLyrics() async {
    final file = _song?.lyricsFile;
    final student = _student;
    final session = _session;
    final token = ++_textEpoch;
    setState(() {
      _lyrics = null;
      _lyricsLoading = file != null;
    });
    if (file == null || student == null || session == null) return;
    try {
      final text = await _api.lyrics(session, student.id, file);
      if (mounted && token == _textEpoch) setState(() => _lyrics = text);
    } on ApiFailure catch (failure) {
      if (mounted && token == _textEpoch) {
        if (failure.status == 403) {
          _mediaDenied();
        } else {
          _failure(failure);
        }
      }
    } catch (_) {
      if (mounted && token == _textEpoch) {
        _message('Не удалось загрузить текст. Проверьте интернет.');
      }
    } finally {
      if (mounted && token == _textEpoch) {
        setState(() => _lyricsLoading = false);
      }
    }
  }

  void _message(String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  void _openSong(Song song) {
    setState(() {
      _songId = song.key;
      _error = null;
    });
    unawaited(_loadLyrics());
  }

  void _back() {
    _textEpoch++;
    setState(() {
      if (_songId != null) {
        _songId = null;
        _lyrics = null;
        _lyricsLoading = false;
      } else {
        _studentId = null;
      }
      _query = '';
      _error = null;
    });
  }

  void _home() {
    if (_session == null || _library == null || _blocked) return;
    _textEpoch++;
    setState(() {
      _studentId = _session!.isTeacher ? null : _library!.personalSpaceId;
      _songId = null;
      _lyrics = null;
      _lyricsLoading = false;
      _archive = false;
      _query = '';
      _error = null;
    });
  }

  Future<void> _addStudent() async {
    final session = _session;
    final epoch = _epoch;
    if (session == null || !session.isTeacher || _blocked) return;
    final created = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) =>
          AddStudentDialog(create: (name) => _api.createStudent(session, name)),
    );
    if (!mounted || epoch != _epoch) return;
    if (created == true) {
      _home();
      _message('Ученик добавлен');
    }
    await _refresh(quiet: true);
  }

  void _showMetronome() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * .8,
        ),
        child: const SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(8, 0, 8, 20),
          child: MetronomePanel(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final canBack =
        !_blocked &&
        (_songId != null ||
            (_session?.isTeacher == true && _studentId != null));
    return PopScope(
      canPop: !canBack,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && canBack) _back();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: canBack ? BackButton(onPressed: _back) : null,
          titleSpacing: canBack ? 0 : 20,
          title: InkWell(
            onTap: _home,
            borderRadius: BorderRadius.circular(10),
            child: Semantics(
              button: true,
              label: 'На главную',
              child: LayoutBuilder(
                builder: (context, constraints) {
                  // Leave navigation and Aa/logout reachable on narrow screens at
                  // large interface scale instead of overflowing the brand mark.
                  if (constraints.maxWidth < 40) return const SizedBox.shrink();
                  return Row(
                    children: [
                      const GardenMark(size: 27),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          'Сад звука',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.headlineMedium
                              ?.copyWith(fontFamily: 'Cormorant', fontSize: 27),
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
          actions: [
            IconButton(
              onPressed: () => showDisplaySettings(context),
              tooltip: 'Размер интерфейса',
              icon: const Text('Aa', style: TextStyle(fontSize: 18)),
            ),
            if (_session != null) ...[
              IconButton(
                onPressed: () => _refresh(),
                tooltip: 'Обновить материалы',
                icon: const Icon(Icons.refresh_rounded),
              ),
              IconButton(
                onPressed: _logout,
                tooltip: 'Выйти',
                icon: const Icon(Icons.logout_rounded),
              ),
            ],
          ],
        ),
        body: SafeArea(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _session == null
              ? _loginView()
              : _library == null || _blocked
              ? _statusView()
              : Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: TextButton.icon(
                          onPressed: _showMetronome,
                          icon: const Icon(Icons.timer_outlined),
                          label: const Text('Метроном'),
                        ),
                      ),
                    ),
                    if (_error != null)
                      MaterialBanner(
                        content: Text(_error!),
                        actions: [
                          TextButton(
                            onPressed: () => _refresh(),
                            child: const Text('Повторить'),
                          ),
                        ],
                      ),
                    Expanded(
                      child: _song == null ? _libraryView() : _songView(_song!),
                    ),
                    ConstrainedBox(
                      constraints: BoxConstraints(
                        maxHeight: MediaQuery.sizeOf(context).height * .46,
                      ),
                      child: SingleChildScrollView(
                        child: SongsPlayer(controller: _player),
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  Widget _loginView() => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Center(child: GardenMark(size: 72)),
            const SizedBox(height: 20),
            Text(
              'Место, где растёт\nтвой голос',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineLarge
                  ?.copyWith(fontFamily: 'Cormorant'),
            ),
            const SizedBox(height: 16),
            const Text(
              'Вставьте свою личную ссылку. Песни и материалы будут те же, что на сайте.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 28),
            TextField(
              controller: _link,
              obscureText: true,
              autocorrect: false,
              enableSuggestions: false,
              keyboardType: TextInputType.url,
              textInputAction: TextInputAction.go,
              onSubmitted: (_) => _login(),
              decoration: const InputDecoration(
                labelText: 'Личная ссылка',
                prefixIcon: Icon(Icons.link),
              ),
            ),
            CheckboxListTile(
              value: _remember,
              onChanged: (v) => setState(() => _remember = v ?? true),
              title: const Text('Запомнить вход на этом устройстве'),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            FilledButton.icon(
              onPressed: _login,
              icon: const Icon(Icons.arrow_forward),
              label: const Padding(
                padding: EdgeInsets.all(14),
                child: Text('Открыть мои материалы'),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Личная ссылка открывает доступ к вашим материалам. Не передавайте её другим.',
              style: TextStyle(fontSize: 12),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    ),
  );
  Widget _statusView() => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            _blocked ? Icons.lock_outline : Icons.cloud_off_outlined,
            size: 48,
          ),
          const SizedBox(height: 20),
          Text(
            _error ?? 'Не удалось открыть библиотеку.',
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () => _refresh(),
            child: const Text('Проверить снова'),
          ),
          TextButton(
            onPressed: _logout,
            child: const Text('Войти по другой ссылке'),
          ),
        ],
      ),
    ),
  );
  Widget _libraryView() {
    final student = _student;
    final query = songKey(_query);
    final songs =
        student?.songs.where((s) => songKey(s.title).contains(query)).toList()
          ?..sort((a, b) => a.key.compareTo(b.key));
    final students = _library!.students.where(
      (s) => s.isArchived == _archive && songKey(s.name).contains(query),
    );
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (_session?.isTeacher == false) _spaceSelector(),
          _eyebrow(student == null ? 'КАБИНЕТ ПРЕПОДАВАТЕЛЯ' : 'МОЙ РЕПЕРТУАР'),
          const SizedBox(height: 10),
          Text(
            student?.name ?? 'Пространства учеников',
            style: Theme.of(context).textTheme.headlineLarge,
          ),
          const SizedBox(height: 8),
          Text(
            student == null
                ? 'Песни, голоса и маленькие открытия'
                : '${student.songs.length} песен · материалы для занятий',
          ),
          if (student?.isArchived == true)
            const Text('В архиве · ученику доступ закрыт'),
          const SizedBox(height: 20),
          if (student == null && _session?.isTeacher == true)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.icon(
                  onPressed: _addStudent,
                  icon: const Icon(Icons.person_add_alt_1),
                  label: const Text('Добавить ученика'),
                ),
              ),
            ),
          if (student == null && _session?.isTeacher == true)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, label: Text('Ученики')),
                  ButtonSegment(value: true, label: Text('Архив')),
                ],
                selected: {_archive},
                onSelectionChanged: (values) =>
                    setState(() => _archive = values.first),
              ),
            ),
          TextField(
            key: ValueKey('search-$_studentId'),
            onChanged: (v) => setState(() => _query = v),
            decoration: InputDecoration(
              hintText: student == null ? 'Найти ученика' : 'Найти песню',
              prefixIcon: const Icon(Icons.search),
            ),
          ),
          const SizedBox(height: 20),
          if (student != null) ...[
            if (songs!.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text('Песен пока нет или ничего не найдено.'),
              ),
            for (final song in songs)
              Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 4,
                  ),
                  leading: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.primaryContainer,
                      borderRadius: const BorderRadius.only(
                        topLeft: Radius.circular(20),
                        topRight: Radius.circular(20),
                        bottomLeft: Radius.circular(20),
                        bottomRight: Radius.circular(6),
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(9),
                      child: Icon(
                        Icons.music_note_outlined,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                  ),
                  title: Text(
                    song.title,
                    style: Theme.of(context).textTheme.headlineMedium
                        ?.copyWith(fontSize: 19),
                  ),
                  subtitle: Text(
                    '${song.variants.length} аудиодорожек${song.lyricsFile != null ? ' · есть текст' : ''}',
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _openSong(song),
                ),
              ),
          ] else ...[
            if (students.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text('Здесь пока пусто.'),
              ),
            for (final item in students)
              Card(
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 12,
                  ),
                  leading: CircleAvatar(
                    child: Text(
                      item.name.isEmpty ? '♪' : item.name.characters.first,
                    ),
                  ),
                  title: Text(
                    item.name,
                    style: Theme.of(context).textTheme.headlineMedium
                        ?.copyWith(fontSize: 19),
                  ),
                  subtitle: Text('${item.songs.length} песен'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _selectSpace(item.id),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _songView(Song song) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
    children: [
      if (_session?.isTeacher == false) _spaceSelector(),
      _eyebrow(_student?.name ?? ''),
      const SizedBox(height: 8),
      Text(song.title, style: Theme.of(context).textTheme.headlineLarge),
      const SizedBox(height: 20),
      for (final variant in song.variants) _variantTile(song, variant),
      if (song.variants.isEmpty)
        const Text('Для этой песни пока добавлен только текст.'),
      if (_lyricsLoading)
        const Padding(
          padding: EdgeInsets.all(20),
          child: Center(child: CircularProgressIndicator()),
        ),
      if (_lyrics != null) _textCard('Текст песни', _lyrics!, formatted: true),
      for (final entry in {
        'translation': 'Перевод',
        'notes': 'Заметки',
        'impulse': 'Импульс',
      }.entries)
        if ((song.meta[entry.key] ?? '').toString().trim().isNotEmpty)
          _textCard(
            entry.value,
            song.meta[entry.key].toString(),
            formatted: entry.key == 'translation',
          ),
    ],
  );
  Widget _spaceSelector() {
    final spaces = _library!.students;
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: DropdownButtonFormField<String>(
        key: ValueKey('space-selector-$_studentId'),
        initialValue: spaces.any((space) => space.id == _studentId)
            ? _studentId
            : null,
        isExpanded: true,
        menuMaxHeight: MediaQuery.sizeOf(context).height * .6,
        decoration: const InputDecoration(labelText: 'Мои пространства'),
        items: [
          for (final space in spaces)
            DropdownMenuItem(
              value: space.id,
              child: Text(
                '${space.name} · ${space.kindLabel}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
        selectedItemBuilder: (context) => [
          for (final space in spaces)
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '${space.name} · ${space.kindLabel}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
        onChanged: (id) {
          if (id != null) _selectSpace(id);
        },
      ),
    );
  }

  Widget _eyebrow(String text) => Text(
    text.toUpperCase(),
    style: TextStyle(
      color: Theme.of(context).colorScheme.onSurfaceVariant,
      letterSpacing: 1.4,
      fontSize: 10,
      fontWeight: FontWeight.w700,
    ),
  );

  Widget _variantTile(Song song, AudioVariant variant) {
    final palette = variantPalette(variant.kind, Theme.of(context).brightness);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: palette.fill,
        borderRadius: BorderRadius.circular(14),
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 4,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          leading: Icon(
            Icons.play_circle_outline,
            color: palette.ink,
            size: 30,
          ),
          title: Text(
            variant.displayName,
            style: TextStyle(color: palette.ink, fontWeight: FontWeight.w600),
          ),
          onTap: () =>
              _player.playVariant(_api, _session!, _student!.id, song, variant),
        ),
      ),
    );
  }

  Widget _textCard(String title, String text, {bool formatted = false}) => Card(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          if (formatted)
            FormattedLyrics(text)
          else
            SelectableText(
              text,
              style: const TextStyle(height: 1.7, fontSize: 16),
            ),
        ],
      ),
    ),
  );
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _epoch++;
    _textEpoch++;
    _link.dispose();
    _player.dispose();
    if (widget.api == null) _api.close();
    super.dispose();
  }
}
