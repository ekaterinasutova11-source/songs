import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract interface class UiSettingsStore {
  Future<double?> readScale();
  Future<void> writeScale(double scale);
}

/// Separate from the personal access key: logging out keeps display preferences.
class SecureUiSettingsStore implements UiSettingsStore {
  static const _storage = FlutterSecureStorage();
  static const _key = 'songs.ui.scale.v1';
  @override
  Future<double?> readScale() async =>
      double.tryParse(await _storage.read(key: _key) ?? '');
  @override
  Future<void> writeScale(double scale) =>
      _storage.write(key: _key, value: scale.toString());
}

class UiSettingsController extends ChangeNotifier {
  UiSettingsController(this.store);
  final UiSettingsStore store;
  static const minScale = .85;
  static const maxScale = 1.5;
  static const options = [.85, 1.0, 1.15, 1.3, 1.5];
  double _scale = 1;
  double get scale => _scale;
  int _revision = 0;
  bool _disposed = false;
  Future<void> _writes = Future.value();

  Future<void> load() async {
    final revision = _revision;
    try {
      final saved = await store.readScale();
      if (!_disposed &&
          revision == _revision &&
          saved != null &&
          saved.isFinite) {
        _scale = saved.clamp(minScale, maxScale);
        notifyListeners();
      }
    } catch (_) {
      // Display storage cannot block access to lessons.
    }
  }

  Future<void> setScale(double value) {
    if (_disposed || !value.isFinite) return Future.value();
    _revision++;
    _scale = value.clamp(minScale, maxScale);
    notifyListeners();
    final saved = _scale;
    final next = _writes.then((_) => store.writeScale(saved));
    _writes = next.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return next;
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

class UiSettingsScope extends InheritedNotifier<UiSettingsController> {
  const UiSettingsScope({
    super.key,
    required UiSettingsController controller,
    required super.child,
  }) : super(notifier: controller);
  static UiSettingsController of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<UiSettingsScope>()!.notifier!;
}

/// Scale layout, icons and touch targets together. System TextScaler is retained,
/// including nonlinear accessibility scaling. Insets are converted to the same
/// logical viewport so safe areas and the keyboard keep their physical size.
class ScaledInterface extends StatelessWidget {
  const ScaledInterface({super.key, required this.scale, required this.child});
  final double scale;
  final Widget child;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final data = MediaQuery.of(context);
      final size = Size(
        constraints.maxWidth / scale,
        constraints.maxHeight / scale,
      );
      return SizedBox.expand(
        child: FittedBox(
          fit: BoxFit.fill,
          alignment: Alignment.topLeft,
          child: SizedBox(
            width: size.width,
            height: size.height,
            child: MediaQuery(
              data: data.copyWith(
                size: size,
                padding: data.padding / scale,
                viewPadding: data.viewPadding / scale,
                viewInsets: data.viewInsets / scale,
                systemGestureInsets: data.systemGestureInsets / scale,
              ),
              child: child,
            ),
          ),
        ),
      );
    },
  );
}

Future<void> showDisplaySettings(BuildContext context) {
  final controller = UiSettingsScope.of(context);
  return showDialog<void>(
    context: context,
    builder: (dialogContext) => ListenableBuilder(
      listenable: controller,
      builder: (context, _) => AlertDialog(
        title: const Text('Размер интерфейса'),
        scrollable: true,
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Меняется размер всего приложения: текста, кнопок и карточек. '
              'Системный размер текста также учитывается.',
            ),
            const SizedBox(height: 20),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final scale in UiSettingsController.options)
                  ChoiceChip(
                    label: Text('${(scale * 100).round()}%'),
                    selected: (controller.scale - scale).abs() < .001,
                    onSelected: (_) async {
                      try {
                        await controller.setScale(scale);
                      } catch (_) {
                        if (dialogContext.mounted) {
                          ScaffoldMessenger.of(dialogContext).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'Размер изменён, но сохранить настройку не удалось.',
                              ),
                            ),
                          );
                        }
                      }
                    },
                  ),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () async {
              try {
                await controller.setScale(1);
              } catch (_) {
                if (dialogContext.mounted) {
                  ScaffoldMessenger.of(dialogContext).showSnackBar(
                    const SnackBar(
                      content: Text('Сохранить настройку не удалось.'),
                    ),
                  );
                }
              }
            },
            child: const Text('Сбросить до 100%'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Готово'),
          ),
        ],
      ),
    ),
  );
}
