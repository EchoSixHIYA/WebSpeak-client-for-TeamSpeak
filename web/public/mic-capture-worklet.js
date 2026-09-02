const FRAME_SAMPLES = 960;

class WebSpeakMicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(FRAME_SAMPLES);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input) return true;

    let inputOffset = 0;
    while (inputOffset < input.length) {
      const count = Math.min(input.length - inputOffset, FRAME_SAMPLES - this.offset);
      this.frame.set(input.subarray(inputOffset, inputOffset + count), this.offset);
      this.offset += count;
      inputOffset += count;
      if (this.offset !== FRAME_SAMPLES) continue;

      let sum = 0;
      for (let index = 0; index < this.frame.length; index++) sum += this.frame[index] * this.frame[index];
      const frame = this.frame;
      this.frame = new Float32Array(FRAME_SAMPLES);
      this.offset = 0;
      this.port.postMessage({ samples: frame, rms: Math.sqrt(sum / FRAME_SAMPLES) }, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor("webspeak-mic-capture", WebSpeakMicCaptureProcessor);
