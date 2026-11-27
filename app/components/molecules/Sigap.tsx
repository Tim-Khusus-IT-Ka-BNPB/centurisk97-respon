import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import {
  SIGAP_LOOPS,
  SIGAP_SCENES,
  SIGAP_TAPPED,
  type SigapFrame,
  type SigapScene,
  sameBody,
  sigapSrc,
} from "../../lib/sigap";
import { useText } from "../../lib/text";

type Play = {
  readonly frames: readonly SigapFrame[];
  readonly at: number;
  readonly loops: number;
  readonly tapped: boolean;
};

const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// The next frame of a scene: a greeting played on a tap goes back to the scene; the scene plays its
// loops and then rests on its first frame.
function next(play: Play, scene: readonly SigapFrame[]): Play {
  const at = play.at + 1;
  if (at < play.frames.length) return { ...play, at };
  if (play.tapped) return { frames: scene, at: 0, loops: 0, tapped: false };
  return { ...play, at: 0, loops: play.loops + 1 };
}

// Sigap playing one scene. A tap greets back and plays the scene again. With motion reduced it
// stays on the scene's first frame. What Sigap says is beside it in words, so the renders are
// decoration.
export function Sigap({ scene, className }: { readonly scene: SigapScene; readonly className?: string }) {
  const t = useText();
  const frames = SIGAP_SCENES[scene];
  const [play, setPlay] = useState<Play>({ frames, at: 0, loops: 0, tapped: false });
  const shown = useRef<string>((frames[0] as SigapFrame)[0]);
  const [moving, setMoving] = useState(false);
  useEffect(() => setMoving(!still()), []);
  const resting = !moving || play.loops >= SIGAP_LOOPS || play.frames.length < 2;
  const [file, ms] = (resting ? play.frames[0] : play.frames[play.at]) as SigapFrame;
  useEffect(() => {
    for (const [one] of [...play.frames, ...SIGAP_TAPPED]) new Image().src = sigapSrc(one);
  }, [play.frames]);
  // Each frame its own timer, even one as long as the frame before.
  useEffect(() => {
    if (resting) return;
    const timer = setTimeout(() => setPlay(next(play, frames)), ms);
    return () => clearTimeout(timer);
  }, [resting, ms, frames, play]);
  const hop = !sameBody(shown.current, file);
  shown.current = file;
  return (
    <button
      type="button"
      aria-label={t("sigap.tap")}
      onClick={() => setPlay({ frames: SIGAP_TAPPED, at: 0, loops: 0, tapped: true })}
      className={cn("relative block shrink-0 rounded-full", className)}
    >
      <span className={cn("block size-full", !resting && "sigap-breathe")}>
        <img
          key={file}
          src={sigapSrc(file)}
          alt=""
          width={640}
          height={640}
          className={cn("size-full object-contain", hop && moving && "sigap-hop")}
        />
      </span>
    </button>
  );
}

// Sigap and what it says on this page, in a bubble beside it.
export function SigapSays({
  scene,
  title,
  text,
  children,
  className,
}: {
  readonly scene: SigapScene;
  readonly title: string;
  readonly text: string;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex items-end gap-2", className)}>
      <Sigap key={scene} scene={scene} className="size-24 sm:size-28" />
      <div
        aria-live="polite"
        className="relative mb-4 flex min-w-0 flex-1 flex-col gap-1 rounded-2xl rounded-bl-sm border border-line bg-surface p-3 text-ink shadow-sm"
      >
        <p className="font-bold">{title}</p>
        <p className="text-meta">{text}</p>
        {children}
      </div>
    </div>
  );
}
