const config = require('./config');
const renderAudioVisualizer = require('../src');
renderAudioVisualizer(config)
  .then((exitCode) => {
    console.log(`exited with code: ${exitCode}`);
  });
