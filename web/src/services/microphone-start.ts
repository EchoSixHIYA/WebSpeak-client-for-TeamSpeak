/**
 * Start the browser permission request before waiting for Web Audio to resume.
 * A suspended AudioContext can wait for a user gesture, and must not prevent
 * getUserMedia from showing its permission prompt after the voice connection.
 */
export async function requestMediaBeforeAudioResume<T>(
  requestMedia: () => Promise<T>,
  resumeAudio: () => Promise<unknown>,
): Promise<T> {
  const mediaPromise = requestMedia();
  let resumePromise: Promise<unknown>;
  try {
    resumePromise = Promise.resolve(resumeAudio()).catch(() => undefined);
  } catch {
    resumePromise = Promise.resolve();
  }

  const [media] = await Promise.all([mediaPromise, resumePromise]);
  return media;
}
