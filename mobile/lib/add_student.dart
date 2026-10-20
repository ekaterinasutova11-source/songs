import 'package:flutter/material.dart';

import 'data.dart';

class AddStudentDialog extends StatefulWidget {
  const AddStudentDialog({super.key, required this.create});
  final Future<void> Function(String name) create;
  @override
  State<AddStudentDialog> createState() => _AddStudentDialogState();
}

class _AddStudentDialogState extends State<AddStudentDialog> {
  final _name = TextEditingController();
  bool _saving = false, _uncertain = false;
  String? _error;

  Future<void> _submit() async {
    if (_saving || _uncertain) return;
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Введите имя ученика.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.create(_name.text);
      if (mounted) Navigator.pop(context, true);
    } on ApiFailure catch (error) {
      if (mounted) {
        setState(() {
          _uncertain = error.status == 0 || error.status >= 500;
          _error = _uncertain
              ? 'Не удалось подтвердить добавление. Сначала проверьте список учеников, чтобы не создать повторную запись.'
              : error.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _uncertain = true;
          _error =
              'Не удалось подтвердить добавление. Проверьте список учеников.';
        });
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_saving,
    child: AlertDialog(
      title: const Text('Добавить ученика'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _name,
              autofocus: true,
              enabled: !_saving && !_uncertain,
              maxLength: 200,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submit(),
              decoration: const InputDecoration(labelText: 'Имя ученика'),
            ),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context, false),
          child: Text(_uncertain ? 'Проверить список' : 'Отмена'),
        ),
        FilledButton(
          onPressed: _saving || _uncertain ? null : _submit,
          child: Text(_saving ? 'Добавляем…' : 'Добавить'),
        ),
      ],
    ),
  );
  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }
}
