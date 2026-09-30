import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tile } from "./Tile.jsx";

/** Columnas según pantalla. */
function useCols() {
  const get = () => (typeof window !== "undefined" && window.innerWidth >= 768 ? 12 : 5);
  const [cols, setCols] = useState(get);
  useEffect(() => {
    const f = () => setCols(get());
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return cols;
}

/**
 * Mesa estilo real que se ENCOGE sola: a medida que entran fichas, toda la
 * cadena reduce su tamaño para que las 28 quepan siempre a la vista y en orden.
 * Filas en zigzag unidas por la ficha de la esquina (vertical, 90°).
 */
export function Board({ board, lastMove, dark = false }) {
  const cols = useCols();
  const len = board?.length ?? 0;
  const innerRef = useRef(null);
  const [naturalH, setNaturalH] = useState(0);

  // Escala: 1 hasta 4 fichas, luego encoge hasta 0.35 (28 fichas).
  const scale = len <= 4 ? 1 : Math.max(0.35, 1 - (len - 4) * 0.027);

  useLayoutEffect(() => {
    if (innerRef.current) {
      const h = innerRef.current.offsetHeight;
      setNaturalH((prev) => (prev === h ? prev : h));
    }
  });

  if (len === 0) {
    return <p className="text-white/80 text-center py-8">Mesa vacía — juega tu mejor ficha.</p>;
  }
  const rows = [];
  for (let i = 0; i < len; i += cols) rows.push(board.slice(i, i + cols));
  const lastIdx = len - 1;
  return (
    <div style={{ height: naturalH * scale || undefined }} className="overflow-hidden">
      <div
        ref={innerRef}
        style={{ transform: `scale(${scale})`, transformOrigin: "top center", width: `${100 / scale}%` }}
      >
        <div className="py-1">
          {rows.map((rowTiles, r) => {
            const reversed = r % 2 === 1;
            const cornerK = rowTiles.length - 1;
            return (
              <div key={r} className={`flex gap-0 items-center justify-center ${reversed ? "flex-row-reverse" : "flex-row"}`}>
                {rowTiles.map((t, k) => {
                  const i = r * cols + k;
                  const isCorner = r < rows.length - 1 && k === cornerK;
                  const isLast = lastMove && (lastMove.side === "left" ? i === 0 : i === lastIdx);
                  return (
                    <Tile key={isLast ? `last-${len}` : i} tile={t}
                      dir={isCorner ? "v" : "h"} dark={false}
                      className={isLast ? "board-tile last-move" : isCorner ? "board-tile" : ""} />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
