import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:songs/metronome.dart';

class FakeOutput implements MetronomeOutput {
  int preparations = 0;
  int stops = 0;
  int disposals = 0;
  final clicks = <({bool accent, double volume})>[];
  Completer<void>? preparation;
  Completer<void>? clickCompletion;
  @override
  Future<void> prepare() async {
    preparations++;
    await preparation?.future;
  }

  @override
  Future<void> click({required bool accent, required double volume}) async {
    clicks.add((accent: accent, volume: volume));
    await clickCompletion?.future;
  }

  @override
  Future<void> silence() async {
    stops++;
  }

  @override
  Future<void> dispose() async {
    disposals++;
  }
}

class ManualTimer implements Timer {
  ManualTimer(this.due, this.callback);
  final Duration due;
  final void Function() callback;
  bool active = true;
  int ticks = 0;
  @override
  bool get isActive => active;
  @override
  int get tick => ticks;
  @override
  void cancel() => active = false;
  void fire() {
    if (!active) return;
    active = false;
    ticks++;
    callback();
  }
}

class ManualClock {
  Duration now = Duration.zero;
  final timers = <ManualTimer>[];
  Timer schedule(Duration delay, void Function() callback) {
    final timer = ManualTimer(now + delay, callback);
    timers.add(timer);
    return timer;
  }

  int get activeTimers => timers.where((timer) => timer.isActive).length;
  Future<void> advance(Duration duration) async {
    await Future<void>.delayed(Duration.zero);
    final target = now + duration;
    while (true) {
      final pending =
          timers
              .where((timer) => timer.isActive && timer.due <= target)
              .toList()
            ..sort((a, b) => a.due.compareTo(b.due));
      if (pending.isEmpty) break;
      now = pending.first.due;
      pending.first.fire();
      await Future<void>.delayed(Duration.zero);
    }
    now = target;
  }
}

void main() {
  late FakeOutput output;
  late ManualClock clock;
  late MetronomeController controller;
  setUp(() {
    output = FakeOutput();
    clock = ManualClock();
    controller = MetronomeController(
      initialBpm: 120,
      output: output,
      now: () => clock.now,
      timerFactory: clock.schedule,
    );
  });
  tearDown(() => controller.dispose());

  test('construction is silent; repeated start owns one timer and accents every fourth beat', () async {
    expect(output.preparations, 0);
    expect(clock.activeTimers, 0);
    await Future.wait([
      controller.start(),
      controller.start(),
      controller.start(),
    ]);
    await clock.advance(const Duration(seconds: 2));
    expect(output.preparations, 1);
    expect(output.clicks.length, 5);
    expect(output.clicks.map((click) => click.accent), [
      true,
      false,
      false,
      false,
      true,
    ]);
    expect(clock.activeTimers, 1);
    await controller.stop();
    await clock.advance(const Duration(seconds: 5));
    expect(output.clicks.length, 5);
    expect(clock.activeTimers, 0);
  });

  test(
    'tempo change cancels old deadline and does not add an immediate click',
    () async {
      await controller.start();
      await clock.advance(const Duration(milliseconds: 250));
      controller.setBpm(60);
      expect(clock.activeTimers, 1);
      await clock.advance(const Duration(milliseconds: 999));
      expect(output.clicks.length, 1);
      await clock.advance(const Duration(milliseconds: 1));
      expect(output.clicks.length, 2);
      expect(controller.bpm, 60);
    },
  );

  test('stop during slow preparation prevents a late click or timer', () async {
    output.preparation = Completer<void>();
    final starting = controller.start();
    await Future<void>.delayed(Duration.zero);
    final stopping = controller.stop();
    output.preparation!.complete();
    await Future.wait([starting, stopping]);
    expect(controller.isRunning, false);
    expect(controller.isStarting, false);
    expect(output.clicks, isEmpty);
    expect(clock.activeTimers, 0);
  });

  test('slow UI skips missed clicks instead of a burst', () async {
    await controller.start();
    await Future<void>.delayed(Duration.zero);
    clock.now = const Duration(seconds: 4);
    clock.timers.single.fire();
    await Future<void>.delayed(Duration.zero);
    expect(output.clicks.length, 2);
    final pending = clock.timers.where((timer) => timer.isActive).single;
    expect(pending.due, const Duration(milliseconds: 4500));
  });

  test(
    'a slow native click cannot accumulate queued duplicate clicks',
    () async {
      output.clickCompletion = Completer<void>();
      await controller.start();
      await clock.advance(const Duration(seconds: 2));
      expect(output.clicks.length, 1);
      output.clickCompletion!.complete();
      await Future<void>.delayed(Duration.zero);
      expect(output.clicks.length, 1);
      await clock.advance(const Duration(milliseconds: 500));
      expect(output.clicks.length, 2);
    },
  );

  test(
    'dispose cancels pending beats and frees audio without restarting',
    () async {
      await controller.start();
      await clock.advance(Duration.zero);
      controller.dispose();
      await clock.advance(const Duration(seconds: 3));
      expect(clock.activeTimers, 0);
      expect(output.clicks.length, 1);
      expect(output.disposals, 1);
      await controller.start();
      expect(output.preparations, 1);
    },
  );

  test('volume, accent and BPM bounds remain safe', () async {
    controller.setBpm(999);
    expect(controller.bpm, 240);
    controller.setBpm(-2);
    expect(controller.bpm, 40);
    controller.setVolume(9);
    controller.setVolume(double.nan);
    controller.setAccent(false);
    await controller.start();
    await clock.advance(Duration.zero);
    expect(output.clicks.single, (accent: false, volume: 1.0));
    await controller.stop();
    await controller.start();
    await clock.advance(Duration.zero);
    expect(clock.activeTimers, 1);
    expect(controller.beat, 1);
  });

  testWidgets(
    'opening is silent; lifecycle background and closing stop the pulse',
    (tester) async {
      final output = FakeOutput();
      final clock = ManualClock();
      final controller = MetronomeController(
        output: output,
        now: () => clock.now,
        timerFactory: clock.schedule,
      );
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: MetronomePanel(controller: controller)),
        ),
      );
      expect(output.preparations, 0);
      await tester.tap(find.text('Включить метроном'));
      await tester.pumpAndSettle();
      expect(controller.isRunning, true);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(controller.isRunning, false);
      expect(clock.activeTimers, 0);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(controller.isRunning, false);
      await tester.tap(find.text('Включить метроном'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      expect(controller.isRunning, false);
      expect(clock.activeTimers, 0);
    },
  );
}
