const spawn = require('child_process').spawn;
const ffmpeg = require('ffmpeg-static');

const bufferToUInt8 = (buffer) => {
  if (!(buffer instanceof Buffer)) {
    throw new Error('Buffer argument is not instance of Buffer');
  }

  const numbers = [];
  for (let i = 0; i < buffer.length; i += 1) {
    numbers.push(buffer.readUInt8(i));
  }
  return numbers;
};

const spawnFfmpegAudioReader = (filename, format) => {
  const ffmpegProcess = spawn(ffmpeg.path, ['-i', filename, '-f', format, '-ac', '1', '-']);
  ffmpegProcess.stderr.on('data', function (data) {
    console.log('stderr: ' + data.toString());
  });
  return ffmpegProcess;
};

const createAudioBuffer = (filename, format) =>
  new Promise((resolve, reject) => {
    const audioBuffers = [];
    const ffmpegAudioReader = spawnFfmpegAudioReader(filename, format);
    ffmpegAudioReader.stdout.on('data', function (chunkBuffer) {
      audioBuffers.push(chunkBuffer);
    });
    ffmpegAudioReader.stdout.on('end', function () {
      const resultBuffer = Buffer.concat(audioBuffers);
      resolve(resultBuffer);
    });
  });

module.exports = {
  bufferToUInt8,
  createAudioBuffer
};
