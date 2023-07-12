/**
 * Captures audio from the active tab in Google Chrome.
 * @returns {Promise<MediaStream>} A promise that resolves with the captured audio stream.
 */
function captureTabAudio() {
  return new Promise((resolve) => {
    chrome.tabCapture.capture(
      {
        audio: true,
        video: false,
      },
      (stream) => {
        resolve(stream);
      }
    );
  });
}


/**
 * Sends a message to a specific tab in Google Chrome.
 * @param {number} tabId - The ID of the tab to send the message to.
 * @param {any} data - The data to be sent as the message.
 * @returns {Promise<any>} A promise that resolves with the response from the tab.
 */
function sendMessageToTab(tabId, data) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, data, (response) => {
      resolve(response);
    });
  });
}


/**
 * Resamples the audio data to a target sample rate of 16kHz.
 * @param {Array|ArrayBuffer|TypedArray} audioData - The input audio data.
 * @param {number} [origSampleRate=44100] - The original sample rate of the audio data.
 * @returns {Float32Array} The resampled audio data at 16kHz.
 */
function resampleTo16kHZ(audioData, origSampleRate = 44100) {
  // Convert the audio data to a Float32Array
  const data = new Float32Array(audioData);

  // Calculate the desired length of the resampled data
  const targetLength = Math.round(data.length * (16000 / origSampleRate));

  // Create a new Float32Array for the resampled data
  const resampledData = new Float32Array(targetLength);

  // Calculate the spring factor and initialize the first and last values
  const springFactor = (data.length - 1) / (targetLength - 1);
  resampledData[0] = data[0];
  resampledData[targetLength - 1] = data[data.length - 1];

  // Resample the audio data
  for (let i = 1; i < targetLength - 1; i++) {
    const index = i * springFactor;
    const leftIndex = Math.floor(index).toFixed();
    const rightIndex = Math.ceil(index).toFixed();
    const fraction = index - leftIndex;
    resampledData[i] = data[leftIndex] + (data[rightIndex] - data[leftIndex]) * fraction;
  }

  // Return the resampled data
  return resampledData;
}


/**
 * Starts recording audio from the captured tab.
 * @param {Object} option - The options object containing the currentTabId.
 */
async function startRecord(option) {
  const stream = await captureTabAudio();

  if (stream) {
    // call when the stream inactive
    stream.oninactive = () => {
      window.close();
    };

    const socket = new WebSocket(`ws://${option.host}:${option.port}/`);
    let isServerReady = false;
    socket.onopen = function(e) { 
      socket.send("handshake");
    };

    socket.onmessage = async (event) => {
      console.log(event.data);
      if (isServerReady === false){
        isServerReady = true;
        return;
      }
      
      res = await sendMessageToTab(option.currentTabId, {
        type: "transcript",
        data: event.data,
      });
    };

    
    const audioDataCache = [];
    const context = new AudioContext();
    const mediaStream = context.createMediaStreamSource(stream);
    const recorder = context.createScriptProcessor(4096, 1, 1);

    recorder.onaudioprocess = async (event) => {
      if (!context || !isServerReady) return;

      const inputData = event.inputBuffer.getChannelData(0);
      const audioData16kHz = resampleTo16kHZ(inputData, context.sampleRate);

      audioDataCache.push(inputData);

      // feed inputs and run
      socket.send(audioData16kHz);
    };

    // Prevent page mute
    mediaStream.connect(recorder);
    recorder.connect(context.destination);
    mediaStream.connect(context.destination);
    // }
  } else {
    window.close();
  }
}

/**
 * Listener for incoming messages from the extension's background script.
 * @param {Object} request - The message request object.
 * @param {Object} sender - The sender object containing information about the message sender.
 * @param {Function} sendResponse - The function to send a response back to the message sender.
 */
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  const { type, data } = request;

  switch (type) {
    case "start_capture":
      await startRecord(data);
      break;
    default:
      break;
  }

  sendResponse({});
});
