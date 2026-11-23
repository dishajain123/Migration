import { useCallback, useEffect, useRef, useState } from 'react';
import { speechToText } from '@/services/voice/speechToText';

export type VoiceInputStatus = 'idle' | 'recording' | 'error';

/** Drives the mic button: recording state, elapsed seconds, interim preview, and the final editable transcript. */
export function useSpeechToText(onTranscript: (text: string) => void) {
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<number | null>(null);

  const stopTimer = () => { if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; } };

  const start = useCallback(() => {
    setError(null);
    setInterim('');
    setSeconds(0);
    setStatus('recording');
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    speechToText.start({
      onInterim: setInterim,
      onFinal: (text) => { onTranscript(text); stopTimer(); setStatus('idle'); setInterim(''); },
      onError: (message) => { stopTimer(); setStatus('error'); setError(message); },
      onEnd: () => { stopTimer(); setStatus((s) => (s === 'recording' ? 'idle' : s)); },
    });
  }, [onTranscript]);

  const stop = useCallback(() => { speechToText.stop(); stopTimer(); setStatus('idle'); setInterim(''); }, []);

  // Stop recording if the component (chat input/panel) unmounts while still listening.
  useEffect(() => () => { speechToText.stop(); stopTimer(); }, []);

  return { status, interim, error, seconds, isSupported: speechToText.isSupported(), start, stop };
}
