// Immutable private Google Drive reserve. No writes, sharing changes, or OAuth
// tokens leave this service. The uploaded ZIP remains unchanged.
const RESERVE_FOLDER = '1crP_1Kj7B6yOfvDebb2PYhHVAhEYCuEU';
const INDEX_NAME = 'sad-zvuka-reserve-index.json';
const CHUNK_SIZE = 2 * 1024 * 1024;

function reserveError_(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function uniqueFile_(folder, name) {
  const matches = folder.getFilesByName(name);
  if (!matches.hasNext()) reserveError_(503, 'Резерв ещё не подготовлен');
  const file = matches.next();
  if (matches.hasNext()) reserveError_(503, 'В резерве обнаружены файлы с одинаковыми именами');
  return file;
}
function catalogue_() {
  const folder = DriveApp.getFolderById(RESERVE_FOLDER);
  const index = JSON.parse(uniqueFile_(folder, INDEX_NAME).getBlob().getDataAsString('UTF-8'));
  if (index.version !== 1 || index.readOnly !== true) reserveError_(503, 'Неверный формат резерва');
  const archive = uniqueFile_(folder, index.archive.name);
  const info = Drive.Files.get(archive.getId(), {fields: 'size,md5Checksum'});
  if (Number(info.size) !== index.archive.size || info.md5Checksum !== index.archive.md5)
    reserveError_(503, 'Архив не совпадает с проверенной копией');
  return {index: index, archiveId: archive.getId()};
}
function sha256_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
    .map(function(b) {return ('0' + ((b + 256) % 256).toString(16)).slice(-2);}).join('');
}
function equal_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
function authorize_(index, req) {
  if (typeof req.key !== 'string' || !req.key || req.key.length > 256) reserveError_(401, 'Нет ключа доступа');
  const teacher = equal_(sha256_(req.key), index.teacherKeySha256);
  const own = teacher ? null : index.students.find(function(s) {return equal_(s.key, req.key);});
  if (!teacher && !own) reserveError_(403, 'Ссылка устарела или неверна');
  return {teacher: teacher, own: own};
}
function publicStudent_(student, teacher) {
  const out = {id: student.id, name: student.name, files: student.files.map(function(f) {
    return {name: f.name, size: f.size, modified: f.modified};
  }), meta: student.meta, metadataUnavailable: !!student.metadataUnavailable};
  if (teacher) out.key = student.key;
  return out;
}
function handleReserve_(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) reserveError_(400, 'Неверный запрос');
  const catalogue = catalogue_(), index = catalogue.index, access = authorize_(index, req);
  if (req.action === 'library') return {
    role: access.teacher ? 'teacher' : 'student',
    students: (access.teacher ? index.students : [access.own]).map(function(s) {return publicStudent_(s, access.teacher);}),
    reserve: {readOnly: true, capturedAt: index.capturedAt, incomplete: index.missing.length > 0}
  };
  if (!['fileInfo', 'fileChunk'].includes(req.action)) reserveError_(503, 'Резервная копия доступна только для чтения. Изменения не сохранены.');
  const student = access.teacher ? index.students.find(function(s) {return s.id === req.folder;})
    : (req.folder === access.own.id ? access.own : null);
  if (!student) reserveError_(403, 'Нет доступа к этой папке');
  const file = student.files.find(function(f) {return f.name === req.name;});
  if (!file) reserveError_(404, 'Файл пока отсутствует в резервной копии');
  if (req.action === 'fileInfo') return {size: file.size, sha256: file.sha256, chunkSize: CHUNK_SIZE};
  const start = req.start, length = req.length;
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1
      || length > CHUNK_SIZE || start + length > file.size) reserveError_(400, 'Неверный диапазон файла');
  const first = file.offset + start, last = first + length - 1;
  const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'
    + encodeURIComponent(catalogue.archiveId) + '?alt=media', {
      headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + first + '-' + last},
      muteHttpExceptions: true
    });
  const headers = response.getAllHeaders();
  const rangeName = Object.keys(headers).find(function(k) {return k.toLowerCase() === 'content-range';});
  if (response.getResponseCode() !== 206 || !rangeName
      || String(headers[rangeName]) !== 'bytes ' + first + '-' + last + '/' + index.archive.size)
    reserveError_(502, 'Google не отдал запрошенный фрагмент');
  const bytes = response.getBlob().getBytes();
  if (bytes.length !== length) reserveError_(502, 'Фрагмент файла получен не полностью');
  return {start: start, length: length, data: Utilities.base64Encode(bytes)};
}
function doPost(event) {
  let result;
  try {
    const body = event && event.postData && event.postData.contents;
    if (!body || body.length > 8192) reserveError_(400, 'Неверный запрос');
    result = {ok: true, data: handleReserve_(JSON.parse(body))};
  } catch (error) {
    result = {ok: false, status: error.status || 503,
      error: error.status ? error.message : 'Резервный сервис временно недоступен'};
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({service: 'Сад звука — резерв', version: 1}))
    .setMimeType(ContentService.MimeType.JSON);
}
// Run only as the owner in the editor to authorize read-only access and check
// the exact uploaded archive. This returns counts, never access keys.
function checkReserve() {
  const catalogue = catalogue_();
  console.log(JSON.stringify({students: catalogue.index.students.length,
    missing: catalogue.index.missing.length, archiveVerified: true}));
}
