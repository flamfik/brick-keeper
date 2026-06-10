let stream;
let frame;

export function scannerSupported() {
  return "BarcodeDetector" in globalThis && navigator.mediaDevices?.getUserMedia;
}

export async function startScanner(video, onResult) {
  if (!scannerSupported()) throw new Error("unsupported");
  const formats = await BarcodeDetector.getSupportedFormats();
  const detector = new BarcodeDetector({
    formats: ["qr_code", "code_128", "ean_13", "ean_8", "upc_a", "upc_e"]
      .filter((format) => formats.includes(format))
  });
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();

  const detect = async () => {
    try {
      const [barcode] = await detector.detect(video);
      if (barcode?.rawValue) {
        onResult(barcode.rawValue);
        return;
      }
    } catch {
      // A frame can fail while the camera is changing exposure; retry it.
    }
    frame = requestAnimationFrame(detect);
  };
  detect();
}

export function stopScanner(video) {
  cancelAnimationFrame(frame);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
}
