/** Ficha de dominó con puntos reales. `dir`: 'v' mano vertical, 'h' mesa horizontal. */
const PIPS = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

function Half({ value, dark, mini = false }) {
  return (
    <div className={`grid grid-cols-3 grid-rows-3 ${mini ? "w-6 h-6 p-0.5" : "w-8 h-8 sm:w-9 sm:h-9 p-1"} ${dark ? "bg-slate-800" : "bg-white"}`}>
      {Array.from({ length: 9 }, (_, i) => {
        const r = Math.floor(i / 3), c = i % 3;
        const on = (PIPS[value] ?? []).some(([pr, pc]) => pr === r && pc === c);
        return (
          <div key={i} className="flex items-center justify-center">
            {on && <div className={`rounded-full ${mini ? "w-1 h-1" : "w-1.5 h-1.5"} ${dark ? "bg-amber-300" : "bg-slate-900"}`} />}
          </div>
        );
      })}
    </div>
  );
}

export function Tile({ tile, dir = "v", playable = false, selected = false, small = false, mini = false, dark = false, onClick, className = "" }) {
  const dbl = tile.left === tile.right;
  const cls = [
    "tile-pop rounded-md overflow-hidden border-2 select-none",
    dark ? "border-slate-600" : "border-slate-900",
    playable ? "cursor-pointer playable-breathe hover:-translate-y-1 transition" : "",
    selected ? "ring-4 ring-amber-400 -translate-y-1" : "",
    small ? "opacity-90" : "",
    className,
  ].join(" ");
  const inner = dir === "v" || (dir === "h" && dbl)
    ? <div className="flex flex-col"><Half value={tile.left} dark={dark} mini={mini} /><div className={`h-px ${dark ? "bg-slate-600" : "bg-slate-900"}`} /><Half value={tile.right} dark={dark} mini={mini} /></div>
    : <div className="flex flex-row"><Half value={tile.left} dark={dark} mini={mini} /><div className={`w-px ${dark ? "bg-slate-600" : "bg-slate-900"}`} /><Half value={tile.right} dark={dark} mini={mini} /></div>;
  return <button className={`touch-manipulation ${cls}`} onClick={onClick} title={`[${tile.left}|${tile.right}]`}>{inner}</button>;
}

/** Dorso para manos rivales. */
export function TileBack({ dark }) {
  return (
    <div className={`w-6 h-10 sm:w-7 sm:h-12 rounded border-2 ${dark ? "bg-slate-700 border-slate-500" : "bg-slate-800 border-slate-900"}`}
      title="Ficha boca abajo" />
  );
}
