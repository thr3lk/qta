import { Show, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import {
  attachMedia,
  mediaFile,
  mediaHidden,
  registerMediaController,
  state,
} from "../lib/store";
import { isVideoFile } from "../lib/media";

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function MediaPlayer(): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const [current, setCurrent] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);

  let element: HTMLMediaElement | undefined;
  let stopAtSecs: number | null = null;
  const bindElement = (el: HTMLMediaElement) => {
    element = el;
  };

  onMount(() => {
    registerMediaController({
      seek: (ms, opts) => {
        if (!mediaFile() || mediaHidden()) return;
        const el = element ?? document.querySelector<HTMLMediaElement>("video, audio");
        if (!el) return;
        setExpanded(true);
        stopAtSecs = opts?.stopAtMs != null ? opts.stopAtMs / 1000 : null;
        el.currentTime = ms / 1000;
        if (opts?.play === false) el.pause();
        else void el.play().catch(() => {});
      },
    });
  });

  const togglePlay = () => {
    if (!element) return;
    stopAtSecs = null;
    if (element.paused) void element.play().catch(() => {});
    else element.pause();
  };

  const media = () => mediaFile();
  const mediaName = () => state.transcript?.sourceMediaPath ?? "";
  const showBar = () => state.phase === "ready" && !mediaHidden();
  const needsAttach = () => media() === null;

  const mediaProps = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onTimeUpdate: () => {
      const t = element?.currentTime ?? 0;
      setCurrent(t);
      if (stopAtSecs !== null && t >= stopAtSecs - 0.05) {
        element?.pause();
        stopAtSecs = null;
      }
    },
    onLoadedMetadata: () => setDuration(element?.duration ?? 0),
  };

  return (
    <Show when={showBar()}>
      <div class="media-bar" data-testid="media-bar">
        <Show
          when={!needsAttach()}
          fallback={
            <div class="media-attach" data-testid="media-attach">
              <span class="status-line">
                <Show when={mediaName() !== ""} fallback={<>No media attached</>}>
                  Media from your last session: {mediaName()}
                </Show>
              </span>
              <label class="attach-label">
                Attach media
                <input
                  type="file"
                  class="visually-hidden"
                  data-testid="media-file-input"
                  accept="video/*,audio/*"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) void attachMedia(f);
                  }}
                />
              </label>
            </div>
          }
        >
          <Show
            when={expanded()}
            fallback={
              <button data-testid="media-expand" onClick={() => setExpanded(true)}>
                ▶ {mediaName()}
              </button>
            }
          >
            <div class="media-player">
              <Show
                when={media() !== null && isVideoFile(media()!.name)}
                fallback={
                  <audio
                    ref={bindElement}
                    src={media() ? URL.createObjectURL(media()!) : ""}
                    {...mediaProps}
                  />
                }
              >
                <video
                  class="media-video"
                  ref={bindElement}
                  src={media() ? URL.createObjectURL(media()!) : ""}
                  {...mediaProps}
                />
              </Show>
              <div class="media-controls">
                <button data-testid="media-playpause" onClick={togglePlay}>
                  {playing() ? "Pause" : "Play"}
                </button>
                <span class="status-line" data-testid="media-clock">
                  {formatClock(current())} / {formatClock(duration())}
                </span>
                <input
                  type="range"
                  min="0"
                  max={duration() || 0}
                  step="0.1"
                  value={current()}
                  onInput={(e) => {
                    stopAtSecs = null;
                    if (element) element.currentTime = Number(e.currentTarget.value);
                  }}
                />
                <button title="Collapse player" onClick={() => setExpanded(false)}>
                  ▾
                </button>
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  );
}
