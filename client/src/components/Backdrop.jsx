import { useMemo } from "react";
import { Tile } from "./Tile.jsx";

/** Lluvia lenta de fichas de dominó detrás del contenido. `dark` adapta los colores. */
export function AnimatedBackdrop({ dark = false, count = 14 }) {
  const tiles = useMemo(() => (
    Array.from({ length: count }, (_, i) => ({
      tile: { left: (i * 5 + 1) % 7, right: (i * 3 + 2) % 7 },
      left: `${(i * 67 + 11) % 100}%`,
      top: `${(i * 41 + 7) % 100}%`,
      scale: 0.6 + ((i * 29) % 40) / 50,
      dur: `${9 + ((i * 13) % 8)}s`,
      delay: `${-((i * 17) % 90) / 10}s`,
      drift: ["drift-a", "drift-b", "drift-c"][i % 3],
      dir: i % 2 === 0 ? "v" : "h",
      o: 0.35 + ((i * 7) % 30) / 100,
    }))
  ), [count]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* resplandores de profundidad */}
      <div className={`absolute -top-24 -left-24 w-96 h-96 rounded-full blur-3xl ${dark ? "bg-emerald-900/60" : "bg-emerald-200/70"}`} />
      <div className={`absolute -bottom-28 -right-20 w-[28rem] h-[28rem] rounded-full blur-3xl ${dark ? "bg-amber-900/40" : "bg-amber-200/60"}`} />
      <div className={`absolute top-1/3 left-2/3 w-72 h-72 rounded-full blur-3xl ${dark ? "bg-teal-800/50" : "bg-teal-100/80"}`} />
      {tiles.map((t, i) => (
        <span key={i} className="absolute" style={{ left: t.left, top: t.top, opacity: t.o }}>
          <span className="block" style={{ animation: `${t.drift} ${t.dur} ease-in-out infinite`, animationDelay: t.delay }}>
            <span className="block" style={{ transform: `scale(${t.scale}) rotate(${(i * 53) % 40 - 20}deg)` }}>
              <Tile tile={t.tile} dir={t.dir} dark={dark} small />
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}
