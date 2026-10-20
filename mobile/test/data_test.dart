import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:songs/data.dart';

void main() {
  const key = 'test-key-12345';
  const session = Session(key: key, mode: 's');
  group('Personal links', () {
    test('old and current links preserve encoded song and teacher folder', () {
      final old = Session.parse(
        'https://ekaterinasutova11-source.github.io/songs/#/t/$key/s/folder%20one/song/%D0%BF%D0%B5%D1%81%D0%BD%D1%8F%2Ftwo',
      );
      expect(old.isTeacher, isTrue);
      expect(old.folder, 'folder one');
      expect(old.song, 'песня/two');
      final current = Session.parse(
        'https://135.106.183.211/#/s/$key/song/happy',
      );
      expect(current.song, 'happy');
      expect(current.isTeacher, isFalse);
      expect(Session.fromJson(current.toJson()).song, 'happy');
      expect(current.toJson().containsKey('url'), isFalse);
      expect(
        Session.parse('https://135.106.183.211/#/t/$key/archive').archive,
        isTrue,
      );
    });
    test(
      'rejects foreign origins, credentials, ports, and invalid pupil routes',
      () {
        for (final url in [
          'http://135.106.183.211/#/s/$key',
          'https://135.106.183.211.evil.example/#/s/$key',
          'https://evil.example/#/s/$key',
          'https://user@135.106.183.211/#/s/$key',
          'https://135.106.183.211:444/#/s/$key',
          'https://ekaterinasutova11-source.github.io/other/#/s/$key',
          'https://135.106.183.211/#/s/$key/s/other',
          'https://135.106.183.211/#/t/$key/song/%ZZ',
        ]) {
          expect(() => Session.parse(url), throwsFormatException);
        }
      },
    );
    test('invalid stored sessions fail without exposing secret values', () {
      expect(
        () => Session.fromJson({'mode': 's', 'key': key, 'folder': 'other'}),
        throwsFormatException,
      );
      try {
        Session.parse('https://evil.example/#/s/$key');
      } catch (error) {
        expect(error.toString(), isNot(contains(key)));
      }
    });
  });

  group('Website-compatible grouping', () {
    test('normalizes diacritics, yo and apostrophes', () {
      expect(songKey('  Ёлка  D’Ámour  '), "елка d'amour");
    });
    test('nested parentheses do not turn a plus into a minus', () {
      final parsed = parseFileName('Aerials + (-3).mp3');
      expect(parsed.title, 'Aerials');
      expect(parsed.kind, 'plus');
      expect(parsed.label, '-3');
      expect(
        parseFileName('Jean-Jacques (оригинал).m4a').title,
        'Jean-Jacques',
      );
      expect(parseFileName('Song − (низко).wav').kind, 'minus');
    });
    test(
      'merges audio/text, capitalized title, ordered variants and text only',
      () {
        final files = [
          const SongFile(name: 'ёлка + (дубль).mp3', modified: '2026-01-01'),
          const SongFile(name: 'Елка (оригинал).m4a'),
          const SongFile(name: 'Елка - (низко).wav'),
          const SongFile(name: 'Елка -.mp3', modified: '2026-02-01'),
          const SongFile(name: 'елка.txt'),
          const SongFile(name: 'Только текст.txt'),
          const SongFile(name: 'document.pdf'),
        ];
        final songs = groupSongs(
          files,
          meta: {
            'елка': {'notes': 'Заметка'},
          },
        );
        expect(songs, hasLength(2));
        final song = songs.first;
        expect(song.key, 'елка');
        expect(song.title, 'Елка');
        expect(song.modified, '2026-02-01');
        expect(song.lyricsFile?.name, 'елка.txt');
        expect(song.meta['notes'], 'Заметка');
        expect(song.variants.map((v) => v.displayName), [
          'Минус',
          'Минус · низко',
          'Плюс · дубль',
          'Оригинал',
        ]);
        expect(songs.last.variants, isEmpty);
        expect(songs.last.lyricsFile?.name, 'Только текст.txt');
      },
    );
  });

  group('Selectel API', () {
    test('fixed endpoint, original file names and redirect disabled', () async {
      final api = SongsApi(
        client: MockClient((request) async {
          expect(request.url.toString(), '$serverOrigin/api');
          expect(request.followRedirects, isFalse);
          final body = jsonDecode(request.body) as Map;
          expect(body['key'], key);
          expect(body['name'], 'Песня  + (−3).mp3');
          return http.Response(
            jsonEncode({'href': '$serverOrigin/media?token=test'}),
            200,
          );
        }),
      );
      expect(
        (await api.mediaUrl(session, 'folder', 'Песня  + (−3).mp3')).path,
        '/media',
      );
    });
    test('403 uses safe access message, never raw server body', () async {
      final api = SongsApi(
        client: MockClient(
          (_) async => http.Response('SECRET $key token=private', 403),
        ),
      );
      try {
        await api.library(session);
        fail('Expected access failure');
      } on ApiFailure catch (error) {
        expect(error.status, 403);
        expect(error.message, contains('Доступ закрыт'));
        expect(error.toString(), isNot(contains(key)));
        expect(error.toString(), isNot(contains('private')));
      }
    });
    test('media URLs cannot redirect playback to foreign hosts', () async {
      for (final href in [
        'https://evil.example/media?token=test',
        'http://135.106.183.211/media?token=test',
        '$serverOrigin/api?token=test',
        'https://user@135.106.183.211/media?token=test',
        '$serverOrigin/media',
      ]) {
        final api = SongsApi(
          client: MockClient(
            (_) async => http.Response(jsonEncode({'href': href}), 200),
          ),
        );
        await expectLater(
          api.mediaUrl(session, 'folder', 'song.mp3'),
          throwsA(isA<ApiFailure>()),
        );
      }
    });
    test(
      'library includes archive and metadata without retaining pupil keys',
      () async {
        final api = SongsApi(
          client: MockClient(
            (_) async => http.Response(
              jsonEncode({
                'role': 'teacher',
                'students': [
                  {
                    'id': 'one',
                    'name': 'Тест',
                    'key': 'not-retained',
                    'archivedAt': '2026-10-20',
                    'files': [
                      {'name': 'Happy.mp3'},
                    ],
                    'meta': {
                      'happy': {'tempo': 100},
                    },
                  },
                ],
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            ),
          ),
        );
        final library = await api.library(const Session(key: key, mode: 't'));
        expect(library.students.single.isArchived, isTrue);
        expect(library.students.single.songs.single.meta['tempo'], 100);
      },
    );
    test(
      'lyrics follow signed route, decode UTF8, and preserve text',
      () async {
        final api = SongsApi(
          client: MockClient((request) async {
            if (request.method == 'POST') {
              return http.Response(
                jsonEncode({'href': '$serverOrigin/media?token=test'}),
                200,
              );
            }
            expect(request.followRedirects, isFalse);
            return http.Response.bytes(utf8.encode('\ufeffПривет\nМир'), 200);
          }),
        );
        expect(
          await api.lyrics(session, 'one', const SongFile(name: 'Happy.txt')),
          'Привет\nМир',
        );
      },
    );
    test('network exceptions do not expose request URLs or keys', () async {
      final api = SongsApi(
        client: MockClient(
          (_) async => throw http.ClientException('private $key token=secret'),
        ),
      );
      await expectLater(
        api.library(session),
        throwsA(
          isA<ApiFailure>().having(
            (e) => e.toString().contains(key),
            'secret absent',
            isFalse,
          ),
        ),
      );
    });
  });
}
