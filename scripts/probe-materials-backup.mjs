// Checks media container metadata, not full audio decoding or subjective sound quality.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const root = path.resolve(process.argv[2]);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const results = [];
// Some Windows FFmpeg builds cannot open particular Unicode filenames.
// A hard link avoids changing or duplicating the checked material.
const probeDir = path.join(root, 'probe-inputs');
fs.mkdirSync(probeDir, { recursive: true });
for (const file of manifest.records.filter(f => /\.(mp3|wav)$/i.test(f.path))) {
  const alias = path.join(probeDir, `${process.pid}-${results.length}${path.extname(file.path)}`);
  try {
    fs.linkSync(path.join(root, 'files', file.path), alias);
    const { stdout } = await run('C:/ffmpeg/bin/ffprobe.exe', ['-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,codec_name,sample_rate,channels', '-of', 'json',
      alias], { timeout: 30000, windowsHide: true });
    const data = JSON.parse(stdout);
    const audio = data.streams?.find(s => s.codec_type === 'audio');
    const duration = Number(data.format?.duration);
    results.push({ path: file.path, readable: !!audio && Number.isFinite(duration) && duration > 0,
      duration, codec: audio?.codec_name, sampleRate: audio?.sample_rate, channels: audio?.channels });
  } catch { results.push({ path: file.path, readable: false }); }
  finally { if (fs.existsSync(alias)) fs.unlinkSync(alias); }
}
fs.writeFileSync(path.join(root, 'audio-validation.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ files: results.length, readable: results.filter(f => f.readable).length,
  failures: results.filter(f => !f.readable).length, check: 'ffprobe metadata; not full decode' }));
