import { spawn } from 'child_process';
import { path as ffmpegPath } from 'ffmpeg-static';

interface FfmpegVideoWriterConfig {
  audioFilename: string;
  videoFileName: string;
  fps: number;
}

export const spawnFfmpegVideoWriter = (config: FfmpegVideoWriterConfig) => {
  const args = [
    '-y',
    '-i', config.audioFilename,
    '-c:v', 'libx264', '-r', `${config.fps}`, '-pix_fmt', 'yuv420p', config.videoFileName,
    '-r', `${config.fps}`,
    '-i', '-'
  ];
  const ffmpeg = spawn(ffmpegPath, args);
  ffmpeg.stdin.pipe(process.stdout);
  ffmpeg.stderr.on('data', function (data) {
    console.log('stderr: ' + data.toString());
  });
  return ffmpeg;
};
