import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:songs/metronome.dart';

class FakeBackend implements MetronomeBackend {
  final bus = StreamController<Map<String, dynamic>>.broadcast(sync: true);
  int starts = 0, stops = 0, generation = 0;
  bool running = false;
  MetronomeSettings config = MetronomeSettings();
  Completer<void>? startGate, updateGate;
  final updates = <MetronomeSettings>[];
  @override
  Stream<Map<String, dynamic>> get events => bus.stream;
  Map<String, dynamic> get snapshot => {
    ...config.toNative(),
    'running': running,
    'beat': 0,
    'generation': generation,
  };
  @override
  Future<Map<String, dynamic>> state() async => snapshot;
  @override
  Future<Map<String, dynamic>> start(MetronomeSettings settings) async {
    starts++;
    final token = ++generation;
    config = settings;
    final result = {
      ...settings.toNative(),
      'running': true,
      'generation': token,
    };
    await startGate?.future;
    if (token == generation) running = true;
    bus.add(result);
    return result;
  }

  @override
  Future<Map<String, dynamic>> update(MetronomeSettings settings) async {
    updates.add(settings);
    await updateGate?.future;
    config = settings;
    return snapshot;
  }

  @override
  Future<void> stop() async {
    stops++;
    generation++;
    running = false;
    bus.add(snapshot);
  }
}

void main() {
  late FakeBackend backend;
  late MetronomeController controller;
  setUp(() {
    backend = FakeBackend();
    controller = MetronomeController(backend: backend);
  });
  tearDown(() async {
    controller.dispose();
    await backend.bus.close();
  });

  test(
    'silent construction and repeated start own one native service',
    () async {
      expect(backend.starts, 0);
      expect(backend.bus.hasListener, false);
      await Future.wait([
        controller.start(),
        controller.start(),
        controller.start(),
      ]);
      expect(backend.starts, 1);
      expect(controller.isRunning, true);
      await controller.stop();
      expect(controller.isRunning, false);
      expect(backend.stops, 1);
    },
  );

  test('muted beats remain in the one-to-twelve-beat grid', () async {
    controller.setBeats(12);
    controller.toggleBeat(1);
    controller.toggleBeat(11);
    await controller.start();
    expect(backend.config.beats, 12);
    expect(backend.config.activeBeats.length, 12);
    expect(backend.config.activeBeats[1], false);
    expect(backend.config.activeBeats[11], false);
    controller.setBeats(1);
    expect(controller.activeBeats, [true]);
    controller.setBeats(99);
    expect(controller.beats, 12);
  });

  test('pupils get clicks and teachers get all website rhythms', () {
    controller.setPattern('rock');
    expect(controller.pattern, 'click');
    expect(() => MetronomeSettings(pattern: 'rock'), throwsArgumentError);
    final teacher = MetronomeController(isTeacher: true, backend: backend);
    for (final p in metronomePatterns) {
      teacher.setPattern(p.id);
      expect(teacher.pattern, p.id);
    }
    teacher.setPattern('unknown');
    expect(teacher.pattern, 'rockfill');
    expect(metronomePatterns.length, 12);
    teacher.dispose();
  });

  test('late start result and event cannot restart after stop', () async {
    backend.startGate = Completer<void>();
    final starting = controller.start();
    await Future<void>.delayed(Duration.zero);
    expect(backend.starts, 1);
    await controller.stop();
    backend.startGate!.complete();
    await starting;
    expect(controller.isRunning, false);
    expect(controller.isStarting, false);
  });

  test(
    'notification stop is reflected and stale generations are ignored',
    () async {
      await controller.start();
      final old = backend.snapshot;
      await backend.stop();
      expect(controller.isRunning, false);
      backend.bus.add({...old, 'running': true, 'beat': 2});
      expect(controller.isRunning, false);
    },
  );

  test(
    'rapid tempo slider changes coalesce while native update is pending',
    () async {
      await controller.start();
      backend.updateGate = Completer<void>();
      for (var bpm = 90; bpm <= 190; bpm++) {
        controller.setBpm(bpm);
      }
      expect(backend.updates.length, 1);
      backend.updateGate!.complete();
      await Future<void>.delayed(Duration.zero);
      expect(backend.updates.length, 2);
      expect(backend.updates.last.bpm, 190);
    },
  );

  test(
    'activity recreation restores native settings without restarting',
    () async {
      backend.running = true;
      backend.config = MetronomeSettings(
        bpm: 152,
        beats: 7,
        activeBeats: [true, false, true, true, true, false, true],
        volume: .25,
      );
      await controller.initialize();
      expect(controller.isRunning, true);
      expect(controller.bpm, 152);
      expect(controller.beats, 7);
      expect(controller.volume, .25);
      expect(backend.starts, 0);
    },
  );

  test('invalid settings are rejected before the native channel', () {
    expect(() => MetronomeSettings(beats: 0), throwsArgumentError);
    expect(() => MetronomeSettings(beats: 13), throwsArgumentError);
    expect(() => MetronomeSettings(activeBeats: [true]), throwsArgumentError);
    expect(() => MetronomeSettings(volume: double.nan), throwsArgumentError);
    expect(
      () => MetronomeSettings(pattern: 'unknown', isTeacher: true),
      throwsArgumentError,
    );
  });

  testWidgets('shared controller survives closing its sheet and background', (
    tester,
  ) async {
    final native = FakeBackend();
    final shared = MetronomeController(backend: native);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: MetronomePanel(controller: shared)),
      ),
    );
    await tester.pumpAndSettle();
    expect(native.starts, 0);
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    await tester.tap(find.text('Включить метроном'));
    await tester.pumpAndSettle();
    expect(shared.isRunning, true);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    expect(shared.isRunning, true);
    await tester.pumpWidget(const SizedBox());
    expect(shared.isRunning, true);
    expect(native.stops, 0);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await shared.stop();
    shared.dispose();
    await native.bus.close();
  });
}
