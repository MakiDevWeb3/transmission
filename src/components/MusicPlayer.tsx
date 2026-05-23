import { useEffect, useRef, useState, useCallback } from "react";

interface Track {
  title: string;
  file: string;
}

const BAR_COUNT = 20;

export default function MusicPlayer() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem("mp-vol");
    return saved !== null ? Number(saved) : 1;
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playingRef = useRef(false);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const ctxReadyRef = useRef(false);
  const smoothRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));
  const volumeRef = useRef(volume);
  const hasAutoStartedRef = useRef(false);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}music/playlist.json`)
      .then((r) => r.json())
      .then((data: Track[]) => {
        if (Array.isArray(data) && data.length) setTracks(data);
      })
      .catch(() => {});
  }, []);

  const startViz = useCallback(() => {
    if (animFrameRef.current || !canvasRef.current || !analyserRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const buf = new Uint8Array(analyser.frequencyBinCount);
    const smooth = smoothRef.current;

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(buf);
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);

      const usableBins = Math.floor(buf.length * 0.75);
      const step = Math.floor(usableBins / BAR_COUNT);
      const gap = 3;
      const barW = canvas.width / BAR_COUNT;

      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += buf[i * step + j];
        const raw = (sum / step) / 255;
        smooth[i] = smooth[i] * 0.6 + raw * 0.4;
        const v = smooth[i];
        const h = Math.max(v * canvas.height, 1);
        const x = i * barW + gap / 2;
        const w = barW - gap;
        const alpha = 0.2 + v * 0.8;
        ctx2d.fillStyle = `rgba(199,125,255,${alpha})`;
        ctx2d.fillRect(x, canvas.height - h, w, h);
      }
    };
    draw();
  }, []);

  const stopViz = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = 0;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx2d = canvas.getContext("2d");
      ctx2d?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const ensureAudioCtx = useCallback(async () => {
    if (ctxReadyRef.current || !audioRef.current) return;
    ctxReadyRef.current = true;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const src = ctx.createMediaElementSource(audioRef.current);
    src.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    if (ctx.state === "suspended") await ctx.resume();
  }, []);

  // Unmute on first interaction — also starts playback if autoplay was blocked (iOS Safari)
  useEffect(() => {
    if (!tracks.length) return;
    const ac = new AbortController();
    const onInteract = async () => {
      ac.abort();
      const audio = audioRef.current;
      if (!audio) return;
      audio.muted = false;
      setMuted(false);
      await ensureAudioCtx();
      if (audio.paused) {
        // Autoplay was blocked (iOS Safari) — start now on user gesture
        audio.volume = volumeRef.current;
        try {
          await audio.play();
          setPlaying(true);
        } catch {}
      }
      startViz();
    };
    const { signal } = ac;
    document.addEventListener("click", onInteract, { signal });
    document.addEventListener("keydown", onInteract, { signal });
    document.addEventListener("touchstart", onInteract, { signal });
    return () => ac.abort();
  }, [tracks, ensureAudioCtx, startViz]);

  // Track change + initial muted autoplay (consolidated to fix race with src)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !tracks[currentIdx]) return;

    const was = playingRef.current;
    const wasMuted = audio.muted;
    const isFirstLoad = !hasAutoStartedRef.current;

    setProgress(0);

    const loadAndPlay = (shouldPlay: boolean, startMuted: boolean) => {
      audio.src = `${import.meta.env.BASE_URL}music/${encodeURIComponent(tracks[currentIdx].file)}`;
      audio.muted = startMuted;
      audio.volume = 0;
      audio.load();
      if (shouldPlay) {
        audio.play()
          .then(() => {
            setPlaying(true);
            const target = volumeRef.current;
            let v = 0;
            const fadeIn = () => {
              v = Math.min(v + 0.05, target);
              audio.volume = v;
              if (v < target) requestAnimationFrame(fadeIn);
            };
            requestAnimationFrame(fadeIn);
          })
          .catch(() => {});
      }
    };

    if (isFirstLoad) {
      hasAutoStartedRef.current = true;
      // Muted autoplay — always succeeds, no user gesture needed
      loadAndPlay(true, true);
    } else if (was && !audio.paused) {
      // Crossfade: fade out then switch
      let v = audio.volume;
      const fadeOut = () => {
        v = Math.max(v - 0.05, 0);
        audio.volume = v;
        if (v > 0) requestAnimationFrame(fadeOut);
        else loadAndPlay(true, wasMuted);
      };
      requestAnimationFrame(fadeOut);
    } else {
      loadAndPlay(was, wasMuted);
    }
  }, [currentIdx, tracks]);

  const togglePlay = async () => {
    if (!audioRef.current || !tracks.length) return;
    if (playing) {
      audioRef.current.pause();
      stopViz();
      setPlaying(false);
    } else {
      if (audioRef.current.muted) {
        audioRef.current.muted = false;
        setMuted(false);
      }
      await ensureAudioCtx();
      if (audioCtxRef.current?.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      try {
        await audioRef.current.play();
        setPlaying(true);
        startViz();
      } catch {}
    }
  };

  const go = useCallback((dir: 1 | -1) => {
    setCurrentIdx((i) => (i + dir + tracks.length) % tracks.length);
  }, [tracks.length]);

  useEffect(() => () => cancelAnimationFrame(animFrameRef.current), []);

  if (!tracks.length) return null;

  return (
    <div className="music-player">
      <audio
        ref={audioRef}
        onEnded={() => go(1)}
        onError={() => go(1)}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration) setProgress(a.currentTime / a.duration);
        }}
        preload="auto"
      />
      <canvas ref={canvasRef} className="music-visualizer" width={196} height={36} />
      <div className="music-bar">
        <button className="music-btn" onClick={() => go(-1)} aria-label="Previous">◂</button>
        <button className="music-btn music-play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "⏸" : "▶"}
        </button>
        <button className="music-btn" onClick={() => go(1)} aria-label="Next">▸</button>
      </div>
      <span className="music-track-num">{muted ? "🔇 " : ""}{currentIdx + 1} / {tracks.length}</span>
      <input
        className="music-seek"
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={progress}
        onChange={(e) => {
          const v = Number(e.target.value);
          setProgress(v);
          if (audioRef.current && audioRef.current.duration) {
            audioRef.current.currentTime = v * audioRef.current.duration;
          }
        }}
        aria-label="Seek"
      />
      <input
        className="music-volume"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => {
          const v = Number(e.target.value);
          setVolume(v);
          localStorage.setItem("mp-vol", String(v));
          if (audioRef.current) audioRef.current.volume = v;
        }}
        aria-label="Volume"
      />
    </div>
  );
}
