import { spawn } from 'child_process';
import { path as ffmpegPath } from 'ffmpeg-static';

export const spawnFfmpegVideoWriter = (audioFilename: string, videoFileName: string, fps: number) => {
  const args = [
    '-y',
    '-i', audioFilename,
    '-c:v', 'libx264', '-r', `${fps}`, '-pix_fmt', 'yuv420p', videoFileName,
    '-r', `${fps}`,
    '-i', '-'
  ];
  const ffmpeg = spawn(ffmpegPath, args);
  ffmpeg.stdin.pipe(process.stdout);
  ffmpeg.stderr.on('data', function (data) {
    console.log('stderr: ' + data.toString());
  });
  return ffmpeg;
};
