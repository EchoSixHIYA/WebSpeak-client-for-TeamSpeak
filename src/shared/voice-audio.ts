/** Shared binary framing for the compatibility (PCM/Opus over WebSocket) path. */

export const VOICE_FRAME_SAMPLES = 960;
export const VOICE_PCM_FRAME_BYTES = VOICE_FRAME_SAMPLES * 2;
export const VOICE_PCM_TAG = 0x01;
export const VOICE_OPUS_TAG = 0x02;
/** RFC 6716 maximum Opus packet length; the server validates the same bound. */
export const VOICE_MAX_OPUS_FRAME_BYTES = 1_275;
