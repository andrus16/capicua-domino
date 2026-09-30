import { useEffect, useState } from "react";
import { Tile } from "./Tile.jsx";

/** Columnas según pantalla: 4 en teléfono (fichas grandes), 10 en tablet/PC. */
function useCols() {
  const get = () => (typeof window !== "undefined" && window.innerWidth >= 768 ? 10 : 4);
  const [cols, setCols] = useState(get);
  useEffect(() => {
    const f = () => setCols(get());
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return cols;
}

/**
 * Mesa serpiente estilo mesa real: filas en zigzag unidas por la ficha
 * de la esquina, girada 90° (vertical) como puente hacia la fila de abajo.
 * `lastMove = { side: 'left'|'right' }` resalta la última jugada.
 */
export function Board({ board, lastMove, dark = false }) {
  const cols = useCols();
  if ((board?.length ?? 0) === 0) {
    return <p className="text-white/80 text-center py-8">Mesa vacía — juega tu mejor ficha.</p>;
  }
  const rows = [];
  for (let i = 0; i < board.length; i += cols) rows.push(board.slice(i, i + cols));
  const lastIdx = board.length - 1;
  return (
    <div className="space-y-2">
      {rows.map((rowTiles, r) => {
        const reversed = r % 2 === 1;
        const cornerK = rowTiles.length - 1;
        return (
          <div key={r} className={`flex gap-1.5 items-center justify-center ${reversed ? "flex-row-reverse" : "flex-row"}`}>
            {rowTiles.map((t, k) => {
              const i = r * cols + k;
              const isCorner = r < rows.length - 1 && k === cornerK;
              const isLast = lastMove && (lastMove.side === "left" ? i === 0 : i === lastIdx);
              return (
                <Tile key={isLast ? `last-${board.length}` : i} tile={t}
                  dir={isCorner ? "v" : "h"} small dark={false}
                  className={isLast ? "board-tile last-move" : isCorner ? "board-tile" : ""} />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
