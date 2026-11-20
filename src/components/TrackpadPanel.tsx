import { useRef, useState, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, Keyboard, MousePointerClick } from 'lucide-react';

interface TrackpadPanelProps {
  onMove: (dx: number, dy: number, wheel?: number) => void;
  onClick: (button: 'left' | 'right') => void;
  onOpenKeyboard?: () => void;
}

export function TrackpadPanel({ onMove, onClick, onOpenKeyboard }: TrackpadPanelProps) {
  const [sensitivity, setSensitivity] = useState<number>(1.4);
  const [touchActive, setTouchActive] = useState(false);

  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const startTimeRef = useRef<number>(0);
  const totalDistRef = useRef<number>(0);
  const scrollLastYRef = useRef<number | null>(null);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    startTimeRef.current = Date.now();
    totalDistRef.current = 0;
    setTouchActive(true);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!lastPosRef.current) return;
    const rawDx = e.clientX - lastPosRef.current.x;
    const rawDy = e.clientY - lastPosRef.current.y;
    lastPosRef.current = { x: e.clientX, y: e.clientY };

    totalDistRef.current += Math.abs(rawDx) + Math.abs(rawDy);

    const dx = Math.round(rawDx * sensitivity);
    const dy = Math.round(rawDy * sensitivity);
    if (dx !== 0 || dy !== 0) {
      onMove(dx, dy, 0);
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const elapsed = Date.now() - startTimeRef.current;
    if (elapsed < 220 && totalDistRef.current < 8) {
      onClick('left');
    }
    lastPosRef.current = null;
    setTouchActive(false);
  };

  const handleScrollDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrollLastYRef.current = e.clientY;
  };

  const handleScrollMove = (e: PointerEvent<HTMLDivElement>) => {
    if (scrollLastYRef.current === null) return;
    const dy = e.clientY - scrollLastYRef.current;
    if (Math.abs(dy) >= 14) {
      const wheelSteps = dy > 0 ? -1 : 1;
      onMove(0, 0, wheelSteps);
      scrollLastYRef.current = e.clientY;
    }
  };

  const handleScrollUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    scrollLastYRef.current = null;
  };

  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div>
          <h3 className="font-display text-base font-bold text-[#0F172A]">
            Touchpad / Mouse sem fio
          </h3>
          <p className="text-xs text-[#64748B]">
            Deslize para mover o cursor na TV e toque para clicar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-lg bg-[#F1F5F9] p-1">
            {[
              { label: 'Preciso', val: 0.9 },
              { label: 'Normal', val: 1.4 },
              { label: 'Rápido', val: 2.2 },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setSensitivity(opt.val)}
                className={`min-h-[34px] rounded-md px-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  sensitivity === opt.val
                    ? 'bg-white text-[#0F172A] shadow-sm'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {onOpenKeyboard && (
            <button
              type="button"
              onClick={onOpenKeyboard}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Keyboard className="h-3.5 w-3.5 text-[#1D4ED8]" aria-hidden="true" />
              Abrir teclado
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        {/* Main Touch Surface */}
        <div
          role="application"
          aria-label="Área do touchpad para controlar o ponteiro na TV"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`flex h-64 flex-1 touch-none select-none flex-col items-center justify-center rounded-2xl border transition-colors sm:h-80 ${
            touchActive
              ? 'border-[#1D4ED8] bg-[#EFF6FF]/60'
              : 'border-[#CBD5E1] bg-[#F8FAFC]'
          }`}
        >
          <MousePointerClick className="h-7 w-7 text-[#64748B]" aria-hidden="true" />
          <span className="mt-2 text-xs font-medium text-[#64748B]">
            Arraste o dedo aqui
          </span>
        </div>

        {/* Dedicated Vertical Scroll Strip */}
        <div
          aria-label="Barra de rolagem vertical"
          onPointerDown={handleScrollDown}
          onPointerMove={handleScrollMove}
          onPointerUp={handleScrollUp}
          onPointerCancel={handleScrollUp}
          className="flex h-64 w-14 touch-none select-none flex-col items-center justify-between rounded-2xl border border-[#CBD5E1] bg-[#F1F5F9] py-4 text-[#475569] sm:h-80"
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
          <span className="text-[11px] font-semibold">Scroll</span>
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>

      {/* Physical Left & Right Click Buttons */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onClick('left')}
          className="flex min-h-[52px] items-center justify-center rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-sm font-semibold text-[#0F172A] hover:bg-[#F1F5F9] active:scale-[0.98] cursor-pointer"
        >
          Clique esquerdo
        </button>
        <button
          type="button"
          onClick={() => onClick('right')}
          className="flex min-h-[52px] items-center justify-center rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-sm font-semibold text-[#0F172A] hover:bg-[#F1F5F9] active:scale-[0.98] cursor-pointer"
        >
          Clique direito
        </button>
      </div>
    </div>
  );
}
