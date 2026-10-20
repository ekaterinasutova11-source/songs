import 'dart:async';

import 'package:flutter/material.dart';

import 'metronome_controller.dart';
export 'metronome_controller.dart';

/// Suitable for a bottom sheet. Closing it or leaving the foreground stops ticks.
class MetronomePanel extends StatefulWidget {
  const MetronomePanel({
    super.key,
    this.controller,
    this.expanded = true,
    this.initialBpm = 80,
  });

  final MetronomeController? controller;
  final bool expanded;
  final int initialBpm;

  @override
  State<MetronomePanel> createState() => _MetronomePanelState();
}

class _MetronomePanelState extends State<MetronomePanel>
    with WidgetsBindingObserver {
  late final MetronomeController _controller;
  late bool _expanded;

  @override
  void initState() {
    super.initState();
    _controller =
        widget.controller ?? MetronomeController(initialBpm: widget.initialBpm);
    _expanded = widget.expanded;
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) unawaited(_controller.stop());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_controller.stop());
    if (widget.controller == null) _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    builder: (context, _) {
      final color = Theme.of(context).colorScheme;
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Icon(Icons.timer_outlined),
                const SizedBox(width: 8),
                const Expanded(child: Text('Метроном')),
                Text('${_controller.bpm} BPM'),
                IconButton(
                  tooltip: _expanded
                      ? 'Свернуть настройки'
                      : 'Развернуть настройки',
                  onPressed: () => setState(() => _expanded = !_expanded),
                  icon: Icon(_expanded ? Icons.expand_less : Icons.expand_more),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var beat = 1; beat <= 4; beat++)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    child: Semantics(
                      label: 'Доля $beat',
                      selected: _controller.beat == beat,
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 60),
                        width: 34,
                        height: 34,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _controller.beat == beat
                              ? color.primary
                              : color.surfaceContainerHighest,
                        ),
                        child: Text(
                          '$beat',
                          style: TextStyle(
                            color: _controller.beat == beat
                                ? color.onPrimary
                                : color.onSurface,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            if (_expanded) ...[
              Row(
                children: [
                  IconButton(
                    tooltip: 'Медленнее на 1 BPM',
                    onPressed: _controller.bpm > MetronomeController.minBpm
                        ? () => _controller.setBpm(_controller.bpm - 1)
                        : null,
                    icon: const Icon(Icons.remove),
                  ),
                  Expanded(
                    child: Slider(
                      label: '${_controller.bpm} BPM',
                      min: MetronomeController.minBpm.toDouble(),
                      max: MetronomeController.maxBpm.toDouble(),
                      divisions:
                          MetronomeController.maxBpm -
                          MetronomeController.minBpm,
                      value: _controller.bpm.toDouble(),
                      onChanged: (value) => _controller.setBpm(value.round()),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Быстрее на 1 BPM',
                    onPressed: _controller.bpm < MetronomeController.maxBpm
                        ? () => _controller.setBpm(_controller.bpm + 1)
                        : null,
                    icon: const Icon(Icons.add),
                  ),
                ],
              ),
              Row(
                children: [
                  const Icon(Icons.volume_up_outlined),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Slider(
                      label: 'Громкость ${(_controller.volume * 100).round()}%',
                      value: _controller.volume,
                      onChanged: _controller.setVolume,
                    ),
                  ),
                ],
              ),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: const Text('Акцент на первую долю'),
                value: _controller.accent,
                onChanged: _controller.setAccent,
              ),
            ],
            if (_controller.error != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  _controller.error!,
                  style: TextStyle(color: color.error),
                ),
              ),
            FilledButton.icon(
              onPressed: _controller.isStarting
                  ? null
                  : () {
                      if (_controller.isRunning) {
                        unawaited(_controller.stop());
                      } else {
                        unawaited(_controller.start());
                      }
                    },
              icon: Icon(_controller.isRunning ? Icons.stop : Icons.play_arrow),
              label: Text(
                _controller.isStarting
                    ? 'Подготовка…'
                    : _controller.isRunning
                    ? 'Остановить'
                    : 'Включить метроном',
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Самостоятельный ритм для занятий. Работает, пока открыта панель.',
              style: Theme.of(context).textTheme.bodySmall,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    },
  );
}
