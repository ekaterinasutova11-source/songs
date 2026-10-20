import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class MetronomePattern {
  const MetronomePattern(this.id, this.name, {this.beats = 4});
  final String id;
  final String name;
  final int beats;
}

const metronomePatterns = [
  MetronomePattern('click', 'Щелчки'),
  MetronomePattern('pop', 'Поп · 4/4'),
  MetronomePattern('soft', 'Мягкий · 4/4'),
  MetronomePattern('rock', 'Рок · 4/4'),
  MetronomePattern('hiphop', 'Хип-хоп · 4/4'),
  MetronomePattern('waltz', 'Вальс · 3/4', beats: 3),
  MetronomePattern('funk', 'Фанк · шуршащий'),
  MetronomePattern('latin', 'Латина · конги'),
  MetronomePattern('breakbeat', 'Брейкбит · ломаный'),
  MetronomePattern('shuffle', 'Шаффл · джазовый'),
  MetronomePattern('popfill', 'Поп · хлопки и сбивка'),
  MetronomePattern('rockfill', 'Рок · томы и сбивка'),
];

class MetronomeSettings {
  factory MetronomeSettings({
    int bpm = 80,
    int beats = 4,
    List<bool>? activeBeats,
    double volume = 0.6,
    bool accent = true,
    String pattern = 'click',
    bool isTeacher = false,
  }) {
    if (bpm < 40 ||
        bpm > 240 ||
        beats < 1 ||
        beats > 12 ||
        !volume.isFinite ||
        volume < 0 ||
        volume > 1 ||
        !metronomePatterns.any((item) => item.id == pattern) ||
        (!isTeacher && pattern != 'click')) {
      throw ArgumentError('Некорректные настройки метронома');
    }
    final mask = activeBeats ?? List<bool>.filled(beats, true);
    if (mask.length != beats) throw ArgumentError('Количество долей');
    return MetronomeSettings._(
      bpm,
      beats,
      List.unmodifiable(mask),
      volume,
      accent,
      pattern,
      isTeacher,
    );
  }
  const MetronomeSettings._(
    this.bpm,
    this.beats,
    this.activeBeats,
    this.volume,
    this.accent,
    this.pattern,
    this.isTeacher,
  );
  final int bpm;
  final int beats;
  final List<bool> activeBeats;
  final double volume;
  final bool accent;
  final String pattern;
  final bool isTeacher;

  Map<String, Object> toNative() => {
    'bpm': bpm,
    'beats': beats,
    'activeBeats': activeBeats,
    'volume': volume,
    'accent': accent,
    'pattern': pattern,
    'isTeacher': isTeacher,
  };
}

/// Only configuration/status crosses the channel. All audio timing is native.
abstract interface class MetronomeBackend {
  Stream<Map<String, dynamic>> get events;
  Future<Map<String, dynamic>> state();
  Future<Map<String, dynamic>> start(MetronomeSettings settings);
  Future<Map<String, dynamic>> update(MetronomeSettings settings);
  Future<void> stop();
}

class AndroidMetronomeBackend implements MetronomeBackend {
  static const _methods = MethodChannel('songs/metronome');
  static const _events = EventChannel('songs/metronome/events');
  void _supported() {
    if (defaultTargetPlatform != TargetPlatform.android) {
      throw UnsupportedError('Native метроном пока подготовлен для Android');
    }
  }

  @override
  Stream<Map<String, dynamic>> get events {
    _supported();
    return _events.receiveBroadcastStream().map(
      (value) => Map<String, dynamic>.from(value as Map),
    );
  }

  Future<Map<String, dynamic>> _call(String action, [Object? arguments]) async {
    _supported();
    final result = await _methods.invokeMapMethod<String, dynamic>(
      action,
      arguments,
    );
    return result ?? <String, dynamic>{};
  }

  @override
  Future<Map<String, dynamic>> state() => _call('state');
  @override
  Future<Map<String, dynamic>> start(MetronomeSettings settings) =>
      _call('start', settings.toNative());
  @override
  Future<Map<String, dynamic>> update(MetronomeSettings settings) =>
      _call('update', settings.toNative());
  @override
  Future<void> stop() async {
    await _call('stop');
  }
}

/// Owned by the signed-in library, not by the song screen or settings sheet.
/// Closing UI or backgrounding never stops this independent native service.
class MetronomeController extends ChangeNotifier {
  MetronomeController({
    int initialBpm = 80,
    this.isTeacher = false,
    MetronomeBackend? backend,
  }) : _bpm = initialBpm.clamp(minBpm, maxBpm),
       _backend = backend ?? AndroidMetronomeBackend();
  static const minBpm = 40;
  static const maxBpm = 240;
  final bool isTeacher;
  final MetronomeBackend _backend;
  StreamSubscription<Map<String, dynamic>>? _subscription;
  Future<void>? _initialization;
  int _generation = 0;
  int _nativeGeneration = -1;
  int _bpm;
  int _beats = 4;
  List<bool> _activeBeats = List<bool>.filled(4, true);
  int _beat = 0;
  double _volume = .6;
  bool _accent = true;
  String _pattern = 'click';
  bool _running = false;
  bool _starting = false;
  bool _startPending = false;
  bool _updating = false;
  int _settingsVersion = 0;
  bool _disposed = false;
  String? _error;

  int get bpm => _bpm;
  int get beats => _beats;
  List<bool> get activeBeats => List.unmodifiable(_activeBeats);
  int get beat => _beat;
  double get volume => _volume;
  bool get accent => _accent;
  String get pattern => _pattern;
  String get patternName =>
      metronomePatterns.firstWhere((p) => p.id == _pattern).name;
  bool get isRunning => _running;
  bool get isStarting => _starting;
  String? get error => _error;
  String get status => _running ? '$bpm BPM · $patternName' : 'Метроном';

  MetronomeSettings get settings => MetronomeSettings(
    bpm: _bpm,
    beats: _beats,
    activeBeats: _activeBeats,
    volume: _volume,
    accent: _accent,
    pattern: _pattern,
    isTeacher: isTeacher,
  );

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  bool _current(int token) => !_disposed && token == _generation;

  Future<void> initialize() => _initialization ??= _connect();
  Future<void> _connect() async {
    if (_disposed) return;
    try {
      _subscription = _backend.events.listen(
        _applyNative,
        onError: (Object _) {
          /* Start reports a user-facing error if unavailable. */
        },
      );
      final state = await _backend.state();
      if (!_disposed) {
        if (state['running'] == true &&
            !isTeacher &&
            state['pattern'] != 'click') {
          await _backend.stop();
        } else {
          if (state['running'] == true && _settingsVersion == 0) {
            _restoreSettings(state);
          }
          _applyNative(state);
        }
      }
    } catch (_) {
      // Plugin availability is checked again when the user presses Start.
    }
  }

  void _applyNative(Map<String, dynamic> state) {
    if (_disposed) return;
    final nativeGeneration =
        (state['generation'] as num?)?.toInt() ?? _nativeGeneration;
    if (nativeGeneration < _nativeGeneration) return;
    _nativeGeneration = nativeGeneration;
    _running = state['running'] == true;
    if (_running) _error = null;
    if (_running || !_startPending) _starting = false;
    _beat = (state['beat'] as num?)?.toInt() ?? 0;
    if (state['error'] is String) _error = state['error'] as String;
    _notify();
  }

  void _restoreSettings(Map<String, dynamic> state) {
    final bpm = (state['bpm'] as num?)?.toInt();
    final beats = (state['beats'] as num?)?.toInt();
    final volume = (state['volume'] as num?)?.toDouble();
    if (bpm != null && bpm >= minBpm && bpm <= maxBpm) _bpm = bpm;
    if (beats != null && beats >= 1 && beats <= 12) {
      _beats = beats;
      final mask = state['activeBeats'];
      _activeBeats =
          mask is List && mask.length == beats && mask.every((v) => v is bool)
          ? mask.cast<bool>().toList()
          : List.filled(beats, true);
    }
    if (volume != null && volume.isFinite && volume >= 0 && volume <= 1) {
      _volume = volume;
    }
    if (state['accent'] is bool) _accent = state['accent'] as bool;
    final pattern = state['pattern'];
    if (pattern is String &&
        metronomePatterns.any((p) => p.id == pattern) &&
        (isTeacher || pattern == 'click')) {
      _pattern = pattern;
    }
  }

  Future<void> start() async {
    if (_disposed || _running || _startPending) return;
    final token = ++_generation;
    _starting = _startPending = true;
    _error = null;
    _notify();
    try {
      await initialize();
      if (!_current(token)) return;
      final state = await _backend.start(settings);
      if (_current(token)) _applyNative(state);
    } catch (failure) {
      if (_current(token)) {
        _running = false;
        _error = failure is UnsupportedError
            ? 'Метроном для iPhone будет подготовлен на следующем этапе.'
            : 'Не удалось включить метроном. Откройте приложение и повторите.';
      }
    } finally {
      if (_current(token)) {
        _starting = _startPending = false;
        _notify();
      }
    }
  }

  void _settingsChanged() {
    _settingsVersion++;
    _notify();
    if (_running) unawaited(_flushSettings());
  }

  Future<void> _flushSettings() async {
    if (_updating || _disposed) return;
    _updating = true;
    try {
      var sent = -1;
      while (!_disposed && _running && sent != _settingsVersion) {
        sent = _settingsVersion;
        await _backend.update(settings);
      }
    } catch (_) {
      if (!_disposed) {
        _error =
            'Не удалось применить настройки. Остановите метроном и повторите.';
        _notify();
      }
    } finally {
      _updating = false;
    }
  }

  void setBpm(int value) {
    if (_disposed) return;
    _bpm = value.clamp(minBpm, maxBpm);
    _settingsChanged();
  }

  void setBeats(int value) {
    if (_disposed) return;
    final count = value.clamp(1, 12);
    _activeBeats = List.generate(
      count,
      (i) => i < _activeBeats.length ? _activeBeats[i] : true,
    );
    _beats = count;
    if (_beat > count) _beat = 0;
    _settingsChanged();
  }

  void toggleBeat(int index) {
    if (_disposed || index < 0 || index >= _beats) return;
    _activeBeats[index] = !_activeBeats[index];
    _settingsChanged();
  }

  void setVolume(double value) {
    if (_disposed || !value.isFinite) return;
    _volume = value.clamp(0, 1);
    _settingsChanged();
  }

  void setAccent(bool value) {
    if (_disposed) return;
    _accent = value;
    _settingsChanged();
  }

  void setPattern(String value) {
    if (_disposed ||
        !isTeacher ||
        !metronomePatterns.any((item) => item.id == value)) {
      return;
    }
    _pattern = value;
    _settingsChanged();
  }

  Future<void> stop() async {
    if (_disposed) return;
    ++_generation;
    _running = _starting = _startPending = false;
    _beat = 0;
    _notify();
    try {
      await _backend.stop();
    } catch (_) {
      /* No service exists on unsupported platforms. */
    }
  }

  @override
  void dispose() {
    if (_disposed) return;
    ++_generation;
    _disposed = true;
    _running = _starting = _startPending = false;
    unawaited(_subscription?.cancel());
    unawaited(_backend.stop().catchError((Object _) {}));
    super.dispose();
  }
}
