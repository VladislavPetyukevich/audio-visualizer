const TIME_LABEL = 'rendered in';
const config = require('./config');
const renderAudioVisualizer = require('../src');
console.time(TIME_LABEL);
renderAudioVisualizer(config)
  .then((exitCode) => {
    console.log(`exited with code: ${exitCode}`);
    console.timeEnd(TIME_LABEL);
  });
