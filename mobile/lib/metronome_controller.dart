import 'dart:async';

import 'package:audioplayers/audioplayers.dart' as audio;
import 'package:flutter/foundation.dart';

/// Short, independent sounds; this never creates a second just_audio player.
abstract interface class MetronomeOutput {
  Future<void> prepare();
  Future<void> click({required bool accent, required double volume});
  Future<void> silence();
  Future<void> dispose();
}

class NativeMetronomeOutput implements MetronomeOutput {
  audio.AudioPlayer? _normal;
  audio.AudioPlayer? _accent;

  @override
  Future<void> prepare() async {
    if (_normal != null && _accent != null) return;
    final context = audio.AudioContext(
      android: const audio.AudioContextAndroid(
        audioFocus: audio.AndroidAudioFocus.none,
        stayAwake: false,
      ),
      iOS: audio.AudioContextIOS(
        category: audio.AVAudioSessionCategory.playback,
        options: const {audio.AVAudioSessionOptions.mixWithOthers},
      ),
    );
    Future<audio.AudioPlayer> load(String asset) async {
      final player = audio.AudioPlayer();
      try {
        await player.setPlayerMode(audio.PlayerMode.lowLatency);
        await player.setAudioContext(context);
        await player.setReleaseMode(audio.ReleaseMode.stop);
        await player.setSource(audio.AssetSource(asset));
        return player;
      } catch (_) {
        await player.dispose();
        rethrow;
      }
    }

    _normal ??= await load('audio/metronome-click.wav');
    _accent ??= await load('audio/metronome-accent.wav');
  }

  @override
  Future<void> click({required bool accent, required double volume}) async {
    final player = accent ? _accent : _normal;
    if (player == null) return;
    await player.stop();
    await player.setVolume(volume);
    await player.resume();
  }

  @override
  Future<void> silence() async {
    await Future.wait([
      if (_normal != null) _normal!.stop(),
      if (_accent != null) _accent!.stop(),
    ]);
  }

  @override
  Future<void> dispose() async {
    await Future.wait([
      if (_normal != null) _normal!.dispose(),
      if (_accent != null) _accent!.dispose(),
    ]);
    _normal = null;
    _accent = null;
  }
}

/// One monotonic timer, no catch-up burst and no automatic start on creation.
/// This is a practice pulse, not a beat grid synchronized to song playback.
class MetronomeController extends ChangeNotifier {
  MetronomeController({
    int initialBpm = 80,
    MetronomeOutput? output,
    Duration Function()? now,
    Timer Function(Duration, void Function())? timerFactory,
  }) : _bpm = initialBpm.clamp(minBpm, maxBpm),
       _output = output ?? NativeMetronomeOutput(),
       _timerFactory =
           timerFactory ?? ((delay, callback) => Timer(delay, callback)) {
    final watch = Stopwatch()..start();
    _now = now ?? (() => watch.elapsed);
  }

  static const minBpm = 40;
  static const maxBpm = 240;
  final MetronomeOutput _output;
  final Timer Function(Duration, void Function()) _timerFactory;
  late final Duration Function() _now;
  Future<void> _audioWork = Future<void>.value();
  Timer? _timer;
  int _generation = 0;
  int _bpm;
  int _beat = 0;
  double _volume = 0.6;
  bool _accent = true;
  bool _running = false;
  bool _starting = false;
  bool _disposed = false;
  bool _clickPending = false;
  String? _error;
  Duration _deadline = Duration.zero;

  int get bpm => _bpm;
  int get beat => _beat;
  double get volume => _volume;
  bool get accent => _accent;
  bool get isRunning => _running;
  bool get isStarting => _starting;
  String? get error => _error;
  Duration get period => Duration(microseconds: (60000000 / _bpm).round());

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  bool _current(int generation) => !_disposed && generation == _generation;

  Future<void> _enqueue(Future<void> Function() operation) {
    final next = _audioWork.then((_) => operation());
    _audioWork = next.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return next;
  }

  Future<void> start() async {
    if (_disposed || _running || _starting) return;
    final generation = ++_generation;
    _starting = true;
    _error = null;
    _notify();
    try {
      await _enqueue(() async {
        if (_current(generation)) await _output.prepare();
      });
      if (!_current(generation)) return;
      _starting = false;
      _running = true;
      _beat = 0;
      _deadline = _now();
      _tick(generation);
    } catch (_) {
      _fail(generation);
    }
  }

  void _fail(int generation) {
    if (!_current(generation)) return;
    unawaited(stop());
    _error = 'Не удалось включить звук метронома. Попробуйте ещё раз.';
    _notify();
  }

  void _tick(int generation) {
    if (!_current(generation) || !_running) return;
    _timer = null;
    _beat = _beat % 4 + 1;
    final accent = _accent && _beat == 1;
    final volume = _volume;
    // If the native channel is slow, drop a pulse instead of accumulating a
    // queue of late clicks that would later play in a burst.
    if (!_clickPending) {
      _clickPending = true;
      unawaited(
        _enqueue(() async {
          try {
            if (_current(generation) && _running) {
              await _output.click(accent: accent, volume: volume);
            }
          } finally {
            _clickPending = false;
          }
        }).catchError((Object _) => _fail(generation)),
      );
    }
    _notify();
    // Advance from the planned deadline, not the callback completion time.
    // A delayed UI thread skips missed pulses rather than playing a burst.
    if (!_current(generation) || !_running) return;
    _deadline += period;
    final now = _now();
    if (_deadline <= now) _deadline = now + period;
    _timer = _timerFactory(_deadline - now, () => _tick(generation));
  }

  void setBpm(int value) {
    if (_disposed) return;
    final next = value.clamp(minBpm, maxBpm);
    if (next == _bpm) return;
    _bpm = next;
    if (_running) {
      _timer?.cancel();
      final generation = ++_generation;
      // Tempo changes begin a fresh interval, without an extra immediate click.
      _deadline = _now() + period;
      _timer = _timerFactory(period, () => _tick(generation));
    }
    _notify();
  }

  void setVolume(double value) {
    if (_disposed || !value.isFinite) return;
    _volume = value.clamp(0, 1);
    _notify();
  }

  void setAccent(bool value) {
    if (_disposed) return;
    _accent = value;
    _notify();
  }

  Future<void> stop() {
    if (_disposed) return Future<void>.value();
    ++_generation;
    _timer?.cancel();
    _timer = null;
    _running = false;
    _starting = false;
    _beat = 0;
    _notify();
    return _enqueue(_output.silence).catchError((Object _) {});
  }

  @override
  void dispose() {
    if (_disposed) return;
    ++_generation;
    _timer?.cancel();
    _timer = null;
    _running = false;
    _starting = false;
    _disposed = true;
    unawaited(
      _enqueue(() async {
        try {
          await _output.silence();
        } finally {
          await _output.dispose();
        }
      }).catchError((Object _) {}),
    );
    super.dispose();
  }
}
