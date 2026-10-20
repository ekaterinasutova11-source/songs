import 'dart:async';

import 'package:flutter/material.dart';

import 'metronome_controller.dart';
export 'metronome_controller.dart';

class MetronomeButton extends StatelessWidget {
  const MetronomeButton({
    super.key,
    required this.controller,
    required this.onPressed,
  });
  final MetronomeController controller;
  final VoidCallback onPressed;
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) => OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(
        controller.isRunning ? Icons.graphic_eq : Icons.timer_outlined,
      ),
      label: Text(controller.status),
    ),
  );
}

/// The shared controller survives this sheet. Its owner stops it on logout.
class MetronomePanel extends StatefulWidget {
  const MetronomePanel({
    super.key,
    this.controller,
    this.expanded = true,
    this.initialBpm = 80,
    this.isTeacher = false,
  });
  final MetronomeController? controller;
  final bool expanded;
  final int initialBpm;
  final bool isTeacher;
  @override
  State<MetronomePanel> createState() => _MetronomePanelState();
}

class _MetronomePanelState extends State<MetronomePanel> {
  late final MetronomeController _controller;
  late bool _expanded;
  @override
  void initState() {
    super.initState();
    _controller =
        widget.controller ??
        MetronomeController(
          initialBpm: widget.initialBpm,
          isTeacher: widget.isTeacher,
        );
    _expanded = widget.expanded;
    unawaited(_controller.initialize());
  }

  @override
  void dispose() {
    if (widget.controller == null) _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    builder: (context, _) {
      final colors = Theme.of(context).colorScheme;
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
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              runSpacing: 8,
              children: List.generate(_controller.beats, (index) {
                final active = _controller.activeBeats[index];
                final current = _controller.beat == index + 1;
                return Semantics(
                  label: 'Доля ${index + 1}',
                  toggled: active,
                  child: InkWell(
                    borderRadius: BorderRadius.circular(24),
                    onTap: () => _controller.toggleBeat(index),
                    child: Container(
                      width: 42,
                      height: 42,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: current
                            ? colors.primary
                            : active
                            ? colors.surfaceContainerHighest
                            : colors.surface,
                        border: Border.all(
                          color: active
                              ? colors.primary
                              : colors.outlineVariant,
                        ),
                      ),
                      child: Text(
                        active ? '${index + 1}' : '—',
                        style: TextStyle(
                          color: current ? colors.onPrimary : colors.onSurface,
                        ),
                      ),
                    ),
                  ),
                );
              }),
            ),
            if (_expanded) ...[
              const SizedBox(height: 6),
              Text(
                'Нажмите на долю, чтобы включить её или оставить тишину.',
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
              Row(
                children: [
                  const Text('Долей'),
                  IconButton(
                    tooltip: 'Уменьшить число долей',
                    onPressed: _controller.beats > 1
                        ? () => _controller.setBeats(_controller.beats - 1)
                        : null,
                    icon: const Icon(Icons.remove),
                  ),
                  Text('${_controller.beats}'),
                  IconButton(
                    tooltip: 'Увеличить число долей',
                    onPressed: _controller.beats < 12
                        ? () => _controller.setBeats(_controller.beats + 1)
                        : null,
                    icon: const Icon(Icons.add),
                  ),
                ],
              ),
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
                      min: 40,
                      max: 240,
                      divisions: 200,
                      value: _controller.bpm.toDouble(),
                      label: '${_controller.bpm} BPM',
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
              if (_controller.isTeacher)
                DropdownButtonFormField<String>(
                  initialValue: _controller.pattern,
                  decoration: const InputDecoration(labelText: 'Звук и ритм'),
                  items: [
                    for (final pattern in metronomePatterns)
                      DropdownMenuItem(
                        value: pattern.id,
                        child: Text(pattern.name),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) _controller.setPattern(value);
                  },
                ),
              Row(
                children: [
                  const Icon(Icons.volume_up_outlined),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Slider(
                      value: _controller.volume,
                      label: 'Громкость ${(_controller.volume * 100).round()}%',
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
                  style: TextStyle(color: colors.error),
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
              'Продолжает звучать при закрытии панели и в фоне. Остановить можно здесь или в уведомлении Android.',
              style: Theme.of(context).textTheme.bodySmall,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    },
  );
}
