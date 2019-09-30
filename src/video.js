const spawn = require('child_process').spawn;
const ffmpegPath = require('ffmpeg-static').path;

const spawnFfmpegVideoWriter = (audioFilename, videoFileName, fps) => {
  const ffmpeg = spawn(ffmpegPath, ['-y', '-i', audioFilename, '-c:v', 'libx264', '-r', fps, '-pix_fmt', 'yuv420p', videoFileName, '-r', fps, '-i', '-']);
  ffmpeg.stdin.pipe(process.stdout);
  ffmpeg.stderr.on('data', function (data) {
    console.log('stderr: ' + data.toString());
  });
  return ffmpeg;
};

module.exports = {
  spawnFfmpegVideoWriter
};
