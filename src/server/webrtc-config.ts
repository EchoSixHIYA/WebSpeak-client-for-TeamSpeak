/** Default WebRTC media port range used by WebSpeak and its Docker image. */
export const DEFAULT_WEBRTC_UDP_PORT_RANGE: [number, number] = [40000, 40099];

// Kept as a public alias for callers that used the original fixed-range name.
export const WEBRTC_UDP_PORT_RANGE = DEFAULT_WEBRTC_UDP_PORT_RANGE;
export const WEBRTC_UDP_PORT_MIN = 1024;
export const WEBRTC_UDP_PORT_MAX = 65535;
