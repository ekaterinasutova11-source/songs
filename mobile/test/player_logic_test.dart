import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:songs/data.dart';
import 'package:songs/player.dart';

class PendingMediaApi extends SongsApi {
  final started = Completer<void>();
  final response = Completer<Uri>();
  @override
  Future<Uri> mediaUrl(Session session, String folder, String name) {
    started.complete();
    return response.future;
  }
}

const session = Session(key: 'fake-test-only', mode: 's');
const variant = AudioVariant(
  kind: 'minus',
  label: '',
  file: SongFile(name: 'Test -.mp3'),
);
const song = Song(key: 'test', title: 'Test', variants: [variant]);

void main() {
  test('403 revokes playback and drops retry session', () async {
    final api = PendingMediaApi();
    var denied = 0;
    final controller = PlayerController(onAccessDenied: () => denied++);
    final load = controller.playVariant(
      api,
      session,
      'test-folder',
      song,
      variant,
    );
    await api.started.future;
    api.response.completeError(const ApiFailure(403, 'Доступ закрыт.'));
    await load;
    expect(denied, 1);
    expect(controller.hasTrack, false);
    await controller.retry();
    controller.dispose();
    api.close();
  });

  test('a late denial after logout cannot change a newer session', () async {
    final api = PendingMediaApi();
    var denied = 0;
    final controller = PlayerController(onAccessDenied: () => denied++);
    final load = controller.playVariant(
      api,
      session,
      'test-folder',
      song,
      variant,
    );
    await api.started.future;
    await controller.stop();
    api.response.completeError(const ApiFailure(403, 'Доступ закрыт.'));
    await load;
    expect(denied, 0);
    expect(controller.hasTrack, false);
    expect(controller.error, isNull);
    controller.dispose();
    api.close();
  });

  test('seek clamps backwards, forwards and unknown duration', () {
    const total = Duration(seconds: 171);
    expect(boundedSeek(const Duration(seconds: -10), total), Duration.zero);
    expect(boundedSeek(const Duration(seconds: 181), total), total);
    expect(
      boundedSeek(const Duration(milliseconds: 103400), total),
      const Duration(milliseconds: 103400),
    );
    expect(
      boundedSeek(const Duration(seconds: 10), Duration.zero),
      Duration.zero,
    );
  });

  test('playback labels handle zero, minutes and long recordings', () {
    expect(playbackTime(Duration.zero), '0:00');
    expect(playbackTime(const Duration(seconds: 103)), '1:43');
    expect(playbackTime(const Duration(hours: 1, seconds: 2)), '60:02');
  });

  testWidgets('empty player never initializes native plugins', (tester) async {
    final controller = PlayerController();
    await tester.pumpWidget(
      MaterialApp(home: SongsPlayer(controller: controller)),
    );
    expect(find.byType(Slider), findsNothing);
    await controller.stop();
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });
}
