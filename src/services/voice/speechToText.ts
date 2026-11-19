// Browser-native speech-to-text (Web Speech API). No server involvement: audio never leaves the browser, and no raw
// recording is stored - the browser's recognizer turns speech into text natively. Kept behind an interface so a
// future cloud/local STT provider could be swapped in without changing any UI code.

export interface SpeechToTextService {
  isSupported(): boolean;
  start(handlers: {
    onInterim?: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (message: string) => void;
    onEnd?: () => void;
  }): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings to use voice input.',
  'permission-denied': 'Microphone permission was denied. Allow microphone access in your browser settings to use voice input.',
  'no-speech': 'No speech was detected. Try again and speak after pressing the microphone button.',
  'audio-capture': 'No microphone was found on this device.',
  network: 'Speech recognition needs a network connection in this browser.',
  aborted: 'Recording was stopped.',
};

export function createSpeechToText(): SpeechToTextService {
  let recognition: SpeechRecognitionLike | null = null;

  return {
    isSupported: () => getCtor() !== null,

    start({ onInterim, onFinal, onError, onEnd }) {
      const Ctor = getCtor();
      if (!Ctor) { onError('Voice input is not supported in this browser. Try Chrome or Edge, or type your question instead.'); return; }
      try {
        recognition = new Ctor();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = navigator.language || 'en-US';
        recognition.onresult = (ev) => {
          const e = ev as { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
          let interim = '';
          let final = '';
          for (let i = 0; i < e.results.length; i++) {
            const r = e.results[i];
            const text = r[0]?.transcript ?? '';
            if (r.isFinal) final += text; else interim += text;
          }
          if (final) onFinal(final.trim());
          else if (interim) onInterim?.(interim.trim());
        };
        recognition.onerror = (ev) => {
          const code = (ev as { error?: string }).error ?? 'unknown';
          if (code === 'aborted') return; // user-initiated stop, not a failure
          onError(ERROR_MESSAGES[code] ?? 'Voice input failed. Try again or type your question instead.');
        };
        recognition.onend = () => onEnd?.();
        recognition.start();
      } catch {
        onError('Could not start voice input. Try again or type your question instead.');
      }
    },

    stop() {
      try { recognition?.stop(); } catch { /* already stopped */ }
      recognition = null;
    },
  };
}

export const speechToText = createSpeechToText();
