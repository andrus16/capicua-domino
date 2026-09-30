import { useEffect, useState } from "react";
import { Tile } from "./Tile.jsx";

/** Columnas según pantalla: 6 en teléfono, 10 en tablet/PC. */
function useCols() {
  const get = () => (typeof window !== "undefined" && window.innerWidth >= 768 ? 10 : 6);
  const [cols, setCols] = useState(get);
  useEffect(() => {
    const f = () => setCols(get());
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return cols;
}

/**
 * Mesa serpiente: las fichas se leen en zigzag (izq→der, der→izq…),
 * como en una mesa real, con flecha de continuación al final de cada fila.
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
    <div className="space-y-1.5">
      {rows.map((rowTiles, r) => {
        const reversed = r % 2 === 1;
        return (
          <div key={r} className={`flex gap-1.5 items-center justify-center ${reversed ? "flex-row-reverse" : "flex-row"}`}>
            {rowTiles.map((t, k) => {
              const i = r * cols + k;
              const isLast = lastMove && (lastMove.side === "left" ? i === 0 : i === lastIdx);
              return (
                <Tile key={isLast ? `last-${board.length}` : i} tile={t} dir="h" small dark={false}
                  className={isLast ? "board-tile last-move" : ""} />
              );
            })}
            {r < rows.length - 1 && (
              <span className="text-amber-300 font-black text-lg leading-none" title="La cadena sigue en la fila de abajo">
                {reversed ? "⤷" : "⤵"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
