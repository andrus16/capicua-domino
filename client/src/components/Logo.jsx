/** Logo de Capicúa: dos fichas cruzadas (doble 6 al frente) + palabra. */
export function LogoMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Capicúa logo">
      {/* ficha trasera inclinada */}
      <g transform="rotate(-18 50 50)">
        <rect x="34" y="12" width="32" height="60" rx="7" fill="#065f46" stroke="#fbbf24" strokeWidth="3" />
        <line x1="34" y1="42" x2="66" y2="42" stroke="#fbbf24" strokeWidth="2.5" />
        <circle cx="42" cy="24" r="3.4" fill="#fbbf24" /><circle cx="58" cy="24" r="3.4" fill="#fbbf24" />
        <circle cx="42" cy="33" r="3.4" fill="#fbbf24" /><circle cx="58" cy="33" r="3.4" fill="#fbbf24" />
        <circle cx="42" cy="54" r="3.4" fill="#fbbf24" /><circle cx="58" cy="54" r="3.4" fill="#fbbf24" />
        <circle cx="50" cy="63" r="3.4" fill="#fde68a" />
      </g>
      {/* ficha delantera: doble 6 */}
      <g transform="rotate(14 50 50)">
        <rect x="30" y="22" width="34" height="64" rx="7" fill="#f8fafc" stroke="#0f172a" strokeWidth="3.5" />
        <line x1="30" y1="54" x2="64" y2="54" stroke="#0f172a" strokeWidth="2.5" />
        {[[38, 32], [56, 32], [38, 40], [56, 40], [38, 48], [56, 48]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.4" fill="#0f172a" />
        ))}
        {[[38, 64], [56, 64], [38, 72], [56, 72], [38, 80], [56, 80]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.4" fill="#047857" />
        ))}
      </g>
    </svg>
  );
}

export function Logo({ compact = false }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={compact ? 30 : 40} />
      <span className="leading-none">
        <span className="block font-black tracking-tight text-xl">CAPICÚA</span>
        {!compact && <span className="block text-[11px] font-semibold tracking-[0.3em] opacity-70">DOMINÓ</span>}
      </span>
    </span>
  );
}
