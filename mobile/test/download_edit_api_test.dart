import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:songs/data.dart';

void main() {
  test('logout after an upload ticket prevents PUT', () async {
    var active = true;
    var writes = 0;
    final api = SongsApi(
      client: MockClient((r) async {
        if (r.method == 'PUT') {
          writes++;
          return http.Response('{}', 200);
        }
        active = false;
        return http.Response(
          jsonEncode({'href': '$serverOrigin/upload?token=local'}),
          200,
        );
      }),
    );
    await expectLater(
      api.upload(
        const Session(key: 'test-teacher-key', mode: 't'),
        'own',
        'x.mp3',
        Uint8List.fromList([1]),
        canContinue: () => active,
      ),
      throwsA(isA<ApiFailure>()),
    );
    expect(writes, 0);
    api.close();
  });
  const teacher = Session(key: 'test-teacher-key', mode: 't');
  const pupil = Session(key: 'test-pupil-key', mode: 's');
  test('downloads use fresh authorized ticket, verify complete size and forbid redirects', () async {
    var tickets = 0;
    var changed = false;
    final api = SongsApi(
      client: MockClient((r) async {
        expect(r.followRedirects, isFalse);
        if (r.method == 'POST') {
          expect(jsonDecode(r.body)['action'], 'url');
          tickets++;
          return http.Response(
            jsonEncode({'href': '$serverOrigin/media?token=local-test'}),
            200,
          );
        }
        return http.Response.bytes([1, 2, 3], changed ? 403 : 200);
      }),
    );
    final bytes = await api.download(
      pupil,
      'own',
      const SongFile(name: 'song.mp3', size: 3),
    );
    expect(bytes, [1, 2, 3]);
    await expectLater(
      api.download(pupil, 'own', const SongFile(name: 'song.mp3', size: 4)),
      throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 409)),
    );
    changed = true;
    await expectLater(
      api.download(pupil, 'own', const SongFile(name: 'song.mp3', size: 3)),
      throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 403)),
    );
    expect(tickets, 3);
    api.close();
  });
  test(
    'audio uploads are teacher-only and reject foreign ticket destinations',
    () async {
      var requests = 0;
      final api = SongsApi(
        client: MockClient((r) async {
          requests++;
          return http.Response(
            jsonEncode({'href': 'https://evil.example/upload?token=local'}),
            200,
          );
        }),
      );
      await expectLater(
        api.upload(pupil, 'own', 'x.mp3', Uint8List.fromList([1])),
        throwsA(isA<ApiFailure>()),
      );
      expect(requests, 0);
      await expectLater(
        api.upload(teacher, 'own', 'x.mp3', Uint8List.fromList([1])),
        throwsA(isA<ApiFailure>().having((e) => e.status, 'status', 502)),
      );
      expect(requests, 1);
      api.close();
    },
  );
}
