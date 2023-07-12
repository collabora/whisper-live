document.addEventListener("DOMContentLoaded", function() {
  var startButton = document.getElementById("startCapture");
  var stopButton = document.getElementById("stopCapture");

  const useServerCheckbox = document.getElementById("useServerCheckbox");
  browser.storage.local.get("capturingState")
    .then(function(result) {
      var capturingState = result.capturingState;
      if (capturingState && capturingState.isCapturing) {
        toggleCaptureButtons(true);
      } else {
        toggleCaptureButtons(false);
      }
      // Enable the startButton
      startButton.disabled = false;
    })
    .catch(function(error) {
      console.error("Error retrieving capturing state:", error);
      // Enable the startButton
      startButton.disabled = false;
    });
  
  browser.storage.local.get("useServerState", ({ useServerState }) => {
    if (useServerState !== undefined) {
      useServerCheckbox.checked = useServerState;
    }
  });

  startButton.addEventListener("click", function() {
    let host = "localhost";
    let port = "9090";
    const useCollaboraServer = useServerCheckbox.checked;

    if (useCollaboraServer){
      host = "transcription.kurg.org"
      port = "7090"
    }

    browser.tabs.query({ active: true, currentWindow: true })
      .then(function(tabs) {
        browser.tabs.sendMessage(
          tabs[0].id, { action: "startCapture", data: {host, port} });
        toggleCaptureButtons(true);
        browser.storage.local.set({ capturingState: { isCapturing: true } })
          .catch(function(error) {
            console.error("Error storing capturing state:", error);
          });
      })
      .catch(function(error) {
        console.error("Error sending startCapture message:", error);
      });
  });

  stopButton.addEventListener("click", function() {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(function(tabs) {
        browser.tabs.sendMessage(tabs[0].id, { action: "stopCapture" })
          .then(function(response) {
            toggleCaptureButtons(false);
            browser.storage.local.set({ capturingState: { isCapturing: false } })
              .catch(function(error) {
                console.error("Error storing capturing state:", error);
              });
          })
          .catch(function(error) {
            console.error("Error sending stopCapture message:", error);
          });
      })
      .catch(function(error) {
        console.error("Error querying active tab:", error);
      });
  });

  // Function to toggle the capture buttons
  function toggleCaptureButtons(isCapturing) {
    startButton.disabled = isCapturing;
    stopButton.disabled = !isCapturing;
    useServerCheckbox.disabled = isCapturing; // Disable checkbox if capturing
    startButton.classList.toggle("disabled", isCapturing);
    stopButton.classList.toggle("disabled", !isCapturing);
  }

  // Save the checkbox state when it's toggled
  useServerCheckbox.addEventListener("change", () => {
    const useServerState = useServerCheckbox.checked;
    browser.storage.local.set({ useServerState });
  });
});
