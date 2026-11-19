// Browser-native text-to-speech (window.speechSynthesis). Kept behind an interface so a future cloud TTS provider
// could be added later without changing the UI. Only one utterance ever plays at a time (see voiceStore.ts).

export interface SpeakOptions {
  rate?: number;
  voiceURI?: string | null;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

export interface TextToSpeechService {
  isSupported(): boolean;
  speak(text: string, opts?: SpeakOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
  listVoices(): SpeechSynthesisVoice[];
  onVoicesChanged(cb: () => void): () => void;
}

export function createTextToSpeech(): TextToSpeechService {
  const synth = () => window.speechSynthesis;

  return {
    isSupported: () => typeof window !== 'undefined' && 'speechSynthesis' in window,

    speak(text, opts) {
      if (!this.isSupported() || !text.trim()) return;
      synth().cancel(); // stop any previous utterance before starting a new one
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = opts?.rate ?? 1;
      if (opts?.voiceURI) {
        const v = synth().getVoices().find((voice) => voice.voiceURI === opts.voiceURI);
        if (v) utter.voice = v;
      }
      utter.onstart = () => opts?.onStart?.();
      utter.onend = () => opts?.onEnd?.();
      utter.onerror = (e) => { if (e.error !== 'canceled' && e.error !== 'interrupted') opts?.onError?.('Could not play audio for this response.'); };
      synth().speak(utter);
    },

    pause() { if (this.isSupported()) synth().pause(); },
    resume() { if (this.isSupported()) synth().resume(); },
    stop() { if (this.isSupported()) synth().cancel(); },
    listVoices: () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? synth().getVoices() : []),
    onVoicesChanged(cb) {
      if (!this.isSupported()) return () => undefined;
      synth().addEventListener('voiceschanged', cb);
      return () => synth().removeEventListener('voiceschanged', cb);
    },
  };
}

export const textToSpeech = createTextToSpeech();
