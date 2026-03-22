/**
 * Extracts normalized peak amplitude data from an audio URL.
 * Returns an array of values in [0, 1] representing peak amplitudes
 * across evenly-spaced windows of the audio.
 * Scales peaks with duration: ~500 peaks/sec, capped at 20k.
 */
export async function extractWaveformPeaks(
  url: string,
  peakCount?: number,
): Promise<number[]> {
  const audioContext = new AudioContext();
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const channelData = audioBuffer.getChannelData(0);
    const durationSec = audioBuffer.duration;
    const targetPeaks = peakCount ?? Math.min(20000, Math.max(2000, Math.round(durationSec * 500)));
    const samplesPerPeak = Math.max(1, Math.floor(channelData.length / targetPeaks));
    const actualPeaks = Math.ceil(channelData.length / samplesPerPeak);
    const peaks: number[] = [];

    for (let i = 0; i < actualPeaks; i++) {
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, channelData.length);
      let max = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > max) max = abs;
      }
      peaks.push(max);
    }

    const globalMax = Math.max(...peaks, 0.01);
    return peaks.map((p) => p / globalMax);
  } finally {
    await audioContext.close();
  }
}
