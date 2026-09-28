import { useCallback, useEffect, useRef, useState } from 'react';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

export type CameraState = 'idle' | 'starting' | 'running' | 'denied' | 'unavailable' | 'error';

type JsQr = (data: Uint8ClampedArray, width: number, height: number, opts?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' }) => { data: string } | null;

/**
 * Rear camera + QR detection. Uses the native BarcodeDetector where the browser has it (Chrome on
 * Android), otherwise decodes frames with jsQR. Scanning pauses while `paused` is true.
 */
export function useQrCamera(onCode: (code: string) => void, { enabled, paused }: { enabled: boolean; paused: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('idle');
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer = 0;
    let detector: BarcodeDetectorLike | null = null;
    let jsqr: JsQr | null = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unavailable');
        return;
      }
      setState('starting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch({ available: !!caps.torch, on: false });

        const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
        if (Ctor) {
          try {
            const formats = (await Ctor.getSupportedFormats?.()) ?? ['qr_code'];
            if (formats.includes('qr_code')) detector = new Ctor({ formats: ['qr_code'] });
          } catch {
            detector = null;
          }
        }
        if (!detector) jsqr = ((await import('jsqr')) as unknown as { default: JsQr }).default;
        setState('running');
        tick();
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unavailable' : 'error');
      }
    };

    const tick = () => {
      if (cancelled) return;
      timer = window.setTimeout(async () => {
        const video = videoRef.current;
        if (!video || pausedRef.current || video.readyState < 2) return tick();
        try {
          let value: string | null = null;
          if (detector) {
            const found = await detector.detect(video);
            value = found[0]?.rawValue ?? null;
          } else if (jsqr && ctx) {
            const scale = Math.min(1, 640 / Math.max(1, video.videoWidth));
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            value = jsqr(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
          if (value && !pausedRef.current) onCodeRef.current(value);
        } catch {
          /* a bad frame – keep going */
        }
        tick();
      }, 140);
    };

    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [enabled]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch({ available: true, on: next });
    } catch {
      setTorch((t) => ({ ...t, available: false }));
    }
  }, [torch.on]);

  return { videoRef, state, torch, toggleTorch };
}

// ── Feedback sounds (Web Audio; unlocked by the first tap) ────────────────────

let audio: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    if (!audio) audio = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

export function beep(kind: 'ok' | 'warn' | 'error'): void {
  if (!audio) return;
  try {
    const tones = kind === 'ok' ? [[1318, 0.09]] : kind === 'warn' ? [[660, 0.12], [660, 0.12]] : [[220, 0.18], [196, 0.22]];
    let t = audio.currentTime;
    for (const [freq, dur] of tones) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = kind === 'ok' ? 'sine' : 'square';
      osc.frequency.value = freq!;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur!);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur! + 0.02);
      t += dur! + 0.06;
    }
  } catch {
    /* ignore */
  }
}
