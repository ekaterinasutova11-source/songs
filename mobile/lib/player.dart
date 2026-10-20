import 'dart:async';

import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:just_audio_background/just_audio_background.dart';

import 'data.dart';
import 'brand.dart';

/// A seek never escapes the known duration, including a backwards skip at zero.
Duration boundedSeek(Duration requested, Duration total) {
  if (total <= Duration.zero) return Duration.zero;
  return Duration(
    microseconds: requested.inMicroseconds.clamp(0, total.inMicroseconds),
  );
}

String playbackTime(Duration value) {
  final seconds = value.inSeconds.clamp(0, 359999);
  final minutes = seconds ~/ 60;
  return '$minutes:${(seconds % 60).toString().padLeft(2, '0')}';
}

/// Exactly one player owns the foreground and lock-screen playback session.
/// Creating the controller does not touch native plugins or load any material.
class PlayerController extends ChangeNotifier {
  PlayerController({this.onAccessDenied});

  final VoidCallback? onAccessDenied;
  AudioPlayer? _native;
  final List<StreamSubscription<dynamic>> _subscriptions = [];
  Future<void> _operations = Future<void>.value();
  int _generation = 0;
  bool _disposed = false;
  bool _ready = false;
  bool _loading = false;
  bool _playing = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  String? _title;
  String? _variant;
  String? _folderId;
  String? _fileName;
  String? _error;
  double _speed = 1;
  bool _repeat = false;
  Future<void> Function()? _retry;

  bool get hasTrack => _title != null;
  String? get songTitle => _title;
  String? get variantName => _variant;
  String? get playingFolderId => _folderId;
  String? get playingFileName => _fileName;
  String? get error => _error;
  bool get isLoading => _loading;
  bool get isPlaying => _playing;
  bool get canSeek => _ready && _duration > Duration.zero && !_loading;
  Duration get position => boundedSeek(_position, _duration);
  Duration get duration => _duration;
  double get speed => _speed;
  bool get repeat => _repeat;

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  AudioPlayer _player() {
    if (_native != null) return _native!;
    final player = AudioPlayer();
    _native = player;
    _subscriptions.addAll([
      player.positionStream.listen((value) {
        if (_ready) _position = value;
        _changed();
      }),
      player.durationStream.listen((value) {
        if (_ready) _duration = value ?? Duration.zero;
        _changed();
      }),
      player.playerStateStream.listen((state) {
        _playing =
            _ready &&
            state.playing &&
            state.processingState != ProcessingState.completed;
        _changed();
      }),
      player.errorStream.listen((_) {
        if (_ready && !_disposed) {
          _error = 'Не удалось воспроизвести запись. Проверьте интернет и повторите.';
          _playing = false;
          _changed();
        }
      }),
    ]);
    return player;
  }

  bool _current(int generation) => !_disposed && generation == _generation;

  // Native mutations are serialized: an old source cannot finish after a new
  // source and replace it. Generation checks also discard old HTTP responses.
  Future<void> _serialize(Future<void> Function() action) {
    final next = _operations.then((_) => action());
    _operations = next.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return next;
  }

  void _failed(Object failure, int generation) {
    if (!_current(generation)) return;
    _loading = false;
    _playing = false;
    if (failure is ApiFailure) {
      _error = failure.message;
      if (failure.status == 403) {
        unawaited(stop());
        onAccessDenied?.call();
        return;
      }
    } else if (failure is TimeoutException) {
      _error =
          'Запись не ответила вовремя. Проверьте интернет и повторите переход.';
    } else {
      // Native error messages can contain a signed URL; never expose them.
      _error = 'Запись недоступна. Проверьте интернет и нажмите «Повторить».';
    }
    _changed();
  }

  Future<void> playVariant(
    SongsApi api,
    Session session,
    String folder,
    Song song,
    AudioVariant variant, {
    Duration startAt = Duration.zero,
  }) async {
    if (_disposed) return;
    final generation = ++_generation;
    _title = song.title;
    _variant = variant.displayName;
    _folderId = folder;
    _fileName = variant.file.name;
    _position = Duration.zero;
    _duration = Duration.zero;
    _ready = false;
    _loading = true;
    _playing = false;
    _error = null;
    _retry = () =>
        playVariant(api, session, folder, song, variant, startAt: startAt);
    _changed();
    try {
      // Stop the old audio before requesting the new signed ticket.
      await _serialize(() async {
        if (_current(generation)) await _native?.stop();
      });
      if (!_current(generation)) return;
      final uri = await api.mediaUrl(session, folder, variant.file.name);
      if (!_current(generation)) return;
      final artwork = await gardenArtworkUri();
      if (!_current(generation)) return;
      await _serialize(() async {
        if (!_current(generation)) return;
        final player = _player();
        final total = await player
            .setAudioSource(
              AudioSource.uri(
                uri,
                tag: MediaItem(
                  // Public metadata never includes the personal key or signed URL.
                  id: Uri(pathSegments: [folder, variant.file.name]).toString(),
                  title: song.title,
                  artist: variant.displayName,
                  album: 'Сад звука',
                  artUri: artwork,
                ),
              ),
            )
            .timeout(
              const Duration(seconds: 30),
              onTimeout: () async {
                await player.stop();
                throw TimeoutException('Загрузка записи');
              },
            );
        if (!_current(generation)) return;
        await player.setSpeed(_speed);
        await player.setLoopMode(_repeat ? LoopMode.one : LoopMode.off);
        if (!_current(generation)) return;
        _duration = total ?? player.duration ?? Duration.zero;
        if (startAt > Duration.zero) {
          if (_duration <= Duration.zero) {
            _duration = await player.durationStream
                .firstWhere((value) => value != null && value > Duration.zero)
                .then((value) => value!)
                .timeout(
                  const Duration(seconds: 10),
                  onTimeout: () => throw const ApiFailure(
                    422,
                    'Не удалось определить длительность записи для перехода. Повторите загрузку.',
                  ),
                );
          }
          if (!_current(generation)) return;
          if (startAt >= _duration) {
            throw const ApiFailure(
              422,
              'Таймкод выходит за длительность записи.',
            );
          }
          final target = boundedSeek(startAt, _duration);
          await player.seek(target).timeout(const Duration(seconds: 10));
          if (!_current(generation)) return;
          _position = target;
        }
        _ready = true;
        _loading = false;
        _changed();
        _startPlayback(player, generation);
      });
    } catch (failure) {
      _failed(failure, generation);
    }
  }

  void _startPlayback(AudioPlayer player, int generation) {
    // play() completes only when paused/stopped; it must not block the queue.
    unawaited(
      player.play().catchError((Object failure) {
        _failed(failure, generation);
      }),
    );
  }

  Future<void> togglePlayback() async {
    if (!_ready || _loading || _disposed) return;
    final generation = _generation;
    try {
      await _serialize(() async {
        if (!_current(generation)) return;
        final player = _native!;
        if (player.playing &&
            player.processingState != ProcessingState.completed) {
          await player.pause();
        } else {
          if (player.processingState == ProcessingState.completed) {
            await player.seek(Duration.zero);
          }
          if (_current(generation)) _startPlayback(player, generation);
        }
      });
    } catch (failure) {
      _failed(failure, generation);
    }
  }

  Future<void> seekTo(Duration requested) async {
    if (!canSeek || _disposed) return;
    final generation = _generation;
    final target = boundedSeek(requested, _duration);
    try {
      await _serialize(() async {
        if (!_current(generation)) return;
        // just_audio preserves the play/pause state across seek().
        await _native!.seek(target);
        if (_current(generation)) {
          _position = target;
          _changed();
        }
      });
    } catch (failure) {
      _failed(failure, generation);
    }
  }

  /// A timestamp click resumes even a paused track. Native work stays serialized.
  Future<void> seekAndPlay(Duration requested) async {
    if (_disposed) return;
    if (!canSeek) {
      _error = _loading ? 'Дождитесь загрузки записи и нажмите время ещё раз.' : 'Не удалось определить длительность записи. Выберите запись заново.';
      _changed();
      return;
    }
    if (requested >= _duration) {
      _error = 'Таймкод выходит за длительность записи.';
      _changed();
      return;
    }
    final generation = _generation;
    final target = boundedSeek(requested, _duration);
    try {
      await _serialize(() async {
        if (!_current(generation)) return;
        final player = _native!;
        await player
            .seek(target)
            .timeout(
              const Duration(seconds: 10),
              onTimeout: () async {
                await player.pause();
                throw TimeoutException('Переход по времени');
              },
            );
        if (!_current(generation)) return;
        _position = target;
        _error = null;
        _changed();
        _startPlayback(player, generation);
      });
    } catch (failure) {
      _failed(failure, generation);
    }
  }

  Future<void> skip(int seconds) =>
      seekTo(position + Duration(seconds: seconds));

  Future<void> setSpeed(double value) async {
    if (!value.isFinite || value < 0.5 || value > 1.5 || _disposed) return;
    _speed = (value * 100).round() / 100;
    _changed();
    final generation = _generation;
    try {
      await _serialize(() async {
        if (_current(generation)) await _native?.setSpeed(_speed);
      });
    } catch (failure) {
      _failed(failure, generation);
    }
  }

  Future<void> toggleRepeat() async {
    if (_disposed) return;
    _repeat = !_repeat;
    _changed();
    final generation = _generation;
    final mode = _repeat ? LoopMode.one : LoopMode.off;
    try {
      await _serialize(() async {
        if (_current(generation)) await _native?.setLoopMode(mode);
      });
    } catch (failure) {
      _failed(failure, generation);
    }
  }

  Future<void> retry() async {
    if (!_disposed) await _retry?.call();
  }

  Future<void> stop() async {
    ++_generation;
    _retry =
        null; // Drop references to the session on logout/access revocation.
    _title = null;
    _variant = null;
    _folderId = null;
    _fileName = null;
    _ready = false;
    _loading = false;
    _playing = false;
    _position = Duration.zero;
    _duration = Duration.zero;
    _error = null;
    _changed();
    try {
      await _serialize(() async {
        await _native?.stop();
      });
    } catch (_) {
      // Logout must finish even if the audio platform has already shut down.
    }
  }

  @override
  void dispose() {
    _disposed = true;
    ++_generation;
    _retry = null;
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    final player = _native;
    if (player != null) unawaited(player.dispose());
    super.dispose();
  }
}

class SongsPlayer extends StatefulWidget {
  const SongsPlayer({super.key, required this.controller});

  final PlayerController controller;

  @override
  State<SongsPlayer> createState() => _SongsPlayerState();
}

class _SongsPlayerState extends State<SongsPlayer> {
  double? _dragSeconds;
  String? _dragTrack;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final player = widget.controller;
      if (!player.hasTrack) return const SizedBox.shrink();
      final track = '${player.songTitle}\u0000${player.variantName}';
      if (_dragTrack != track || !player.canSeek) _dragSeconds = null;
      final total = player.duration.inMilliseconds / 1000;
      final current = (_dragSeconds ?? player.position.inMilliseconds / 1000)
          .clamp(0.0, total > 0 ? total : 1.0);
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.asset(
                      'assets/brand/cover.png',
                      width: 48,
                      height: 48,
                      excludeFromSemantics: true,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          player.songTitle!,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(
                                fontFamily: 'Lora',
                                fontSize: 18,
                                fontWeight: FontWeight.w500,
                              ),
                        ),
                        Text(
                          player.variantName ?? '',
                          style: TextStyle(
                            color: Theme.of(context)
                                .colorScheme
                                .onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (player.isLoading) const LinearProgressIndicator(),
              if (player.error != null) ...[
                Text(
                  player.error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
                TextButton.icon(
                  onPressed: player.isLoading ? null : player.retry,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Повторить'),
                ),
              ],
              Listener(
                onPointerCancel: (_) => setState(() => _dragSeconds = null),
                child: Slider(
                  label: playbackTime(
                    Duration(milliseconds: (current * 1000).round()),
                  ),
                  semanticFormatterCallback: (value) =>
                      'Позиция ${playbackTime(Duration(seconds: value.round()))}',
                  min: 0,
                  max: total > 0 ? total : 1,
                  value: current,
                  onChanged: player.canSeek
                      ? (value) => setState(() {
                          _dragTrack = track;
                          _dragSeconds = value;
                        })
                      : null,
                  onChangeEnd: player.canSeek
                      ? (value) {
                          final target = Duration(
                            milliseconds: (value * 1000).round(),
                          );
                          setState(() => _dragSeconds = null);
                          unawaited(player.seekTo(target));
                        }
                      : null,
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    playbackTime(
                      Duration(milliseconds: (current * 1000).round()),
                    ),
                  ),
                  Text(playbackTime(player.duration)),
                ],
              ),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 8,
                children: [
                  IconButton(
                    tooltip: 'Назад на 10 секунд',
                    onPressed: player.canSeek ? () => player.skip(-10) : null,
                    icon: const Icon(Icons.replay_10),
                  ),
                  IconButton.filled(
                    tooltip: player.isPlaying ? 'Пауза' : 'Воспроизвести',
                    onPressed: player.isLoading || player.error != null
                        ? null
                        : player.togglePlayback,
                    icon: Icon(
                      player.isPlaying ? Icons.pause : Icons.play_arrow,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Вперёд на 10 секунд',
                    onPressed: player.canSeek ? () => player.skip(10) : null,
                    icon: const Icon(Icons.forward_10),
                  ),
                  IconButton(
                    tooltip: player.repeat
                        ? 'Выключить повтор'
                        : 'Повторять запись',
                    isSelected: player.repeat,
                    onPressed: player.toggleRepeat,
                    icon: const Icon(Icons.repeat_one),
                  ),
                ],
              ),
              Row(
                children: [
                  const Icon(Icons.speed),
                  Expanded(
                    child: Slider(
                      key: const ValueKey('playback-speed'),
                      min: .5,
                      max: 1.5,
                      divisions: 100,
                      value: player.speed,
                      label: '${player.speed.toStringAsFixed(2)}×',
                      onChanged: (value) => unawaited(player.setSpeed(value)),
                    ),
                  ),
                  Text('${player.speed.toStringAsFixed(2)}×'),
                  TextButton(
                    onPressed: () => unawaited(player.setSpeed(1)),
                    child: const Text('1×'),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
    },
  );
}
