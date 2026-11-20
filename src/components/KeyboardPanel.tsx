import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CornerDownLeft,
  Delete,
  Keyboard,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import type { HidKeyboardLayout } from '../types/tv';
import type { InputLogItem } from '../hooks/useBluetoothKeyboard';
import { HID_KEY, HID_MOD } from '../native/bluetoothHidPlugin';

interface KeyboardPanelProps {
  layout: HidKeyboardLayout;
  hapticEnabled: boolean;
  liveBuffer: string;
  recentInputs: InputLogItem[];
  onChangeLayout: (layout: HidKeyboardLayout) => void;
  onToggleHaptic: (enabled: boolean) => void;
  onSendKey: (key: string, modifiers?: number, explicitHidCode?: number) => void;
  onSendText: (text: string, pressEnter?: boolean) => void;
  onClearBuffer: () => void;
  onClose?: () => void;
}

const ACCENT_AND_SYMBOLS = ['á', 'é', 'í', 'ó', 'ú', 'ã', 'õ', 'â', 'ê', 'ç', '@', '.com', '/'];
const NUMBER_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const ROW_1 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
const ROW_2_US = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'];
const ROW_2_ABNT2 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ç'];
const ROW_3 = ['z', 'x', 'c', 'v', 'b', 'n', 'm'];

export function KeyboardPanel({
  layout,
  liveBuffer,
  recentInputs,
  onChangeLayout,
  onSendKey,
  onSendText,
  onClearBuffer,
  onClose,
}: KeyboardPanelProps) {
  const [quickText, setQuickText] = useState('');
  const [shiftActive, setShiftActive] = useState(false);
  const [physicalCapture, setPhysicalCapture] = useState(false);

  useEffect(() => {
    if (!physicalCapture) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
        return;
      }

      e.preventDefault();
      const mods =
        (e.ctrlKey ? HID_MOD.LCTRL : 0) |
        (e.shiftKey ? HID_MOD.LSHIFT : 0) |
        (e.altKey ? HID_MOD.LALT : 0);

      onSendKey(e.key, mods);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSendKey, physicalCapture]);

  const handleCharKey = (char: string) => {
    if (char.length > 1) {
      onSendText(char, false);
      return;
    }

    const outChar = shiftActive ? char.toUpperCase() : char;
    onSendKey(outChar, shiftActive ? HID_MOD.LSHIFT : 0);
    if (shiftActive) setShiftActive(false);
  };

  const handleSpecialKey = (key: string, explicitHidCode?: number) => {
    onSendKey(key, 0, explicitHidCode);
  };

  const handleSubmitQuickText = (pressEnter: boolean) => {
    if (!quickText) return;
    onSendText(quickText, pressEnter);
    setQuickText('');
  };

  const row2Keys = layout === 'abnt2' ? ROW_2_ABNT2 : ROW_2_US;

  return (
    <div className="space-y-3">
      {/* Quick text bar */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3.5 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            aria-label="Texto para enviar para a TV"
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmitQuickText(true);
              }
            }}
            placeholder="Digite ou cole texto, senha ou busca para a TV..."
            className="min-h-[46px] flex-1 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] px-3.5 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#1D4ED8] focus:bg-white"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={!quickText}
              onClick={() => handleSubmitQuickText(false)}
              className="inline-flex min-h-[46px] flex-1 sm:flex-initial items-center justify-center gap-1.5 rounded-xl border border-[#CBD5E1] bg-white px-3.5 text-sm font-semibold text-[#0F172A] hover:bg-[#F8FAFC] disabled:opacity-45 whitespace-nowrap cursor-pointer"
            >
              <Send className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
              Enviar
            </button>
            <button
              type="button"
              disabled={!quickText}
              onClick={() => handleSubmitQuickText(true)}
              className="inline-flex min-h-[46px] flex-1 sm:flex-initial items-center justify-center gap-1.5 rounded-xl bg-[#1D4ED8] px-4 text-sm font-semibold text-white hover:bg-[#1E40AF] disabled:opacity-45 whitespace-nowrap cursor-pointer"
            >
              <CornerDownLeft className="h-4 w-4" aria-hidden="true" />
              Enviar + Enter
            </button>
          </div>
        </div>

        {(liveBuffer || recentInputs.length > 0) && (
          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-[#F1F5F9] pt-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono text-[#475467]">
              {liveBuffer
                ? `Digitado: ${liveBuffer.replace(/\n/g, ' ↵ ')}`
                : `Último: ${recentInputs[0]?.label}`}
            </span>
            <button
              type="button"
              onClick={onClearBuffer}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#64748B] hover:text-[#0F172A] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Limpar
            </button>
          </div>
        )}
      </div>

      {/* Simple Tactile QWERTY Keyboard */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3 sm:p-4">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-[#F1F5F9] pb-2.5">
          <div className="inline-flex items-center gap-1 rounded-lg bg-[#F1F5F9] p-1">
            <button
              type="button"
              onClick={() => onChangeLayout('us_intl')}
              className={`min-h-[32px] rounded-md px-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                layout === 'us_intl'
                  ? 'bg-white text-[#0F172A] shadow-sm'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              US Intl
            </button>
            <button
              type="button"
              onClick={() => onChangeLayout('abnt2')}
              className={`min-h-[32px] rounded-md px-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                layout === 'abnt2'
                  ? 'bg-white text-[#0F172A] shadow-sm'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              ABNT2
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPhysicalCapture((v) => !v)}
              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                physicalCapture
                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                  : 'border-[#CBD5E1] bg-white text-[#475569] hover:bg-[#F8FAFC]'
              }`}
            >
              <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
              {physicalCapture ? 'Teclado físico ativo' : 'Usar teclado físico'}
            </button>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar teclado"
                className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-2.5 text-xs font-medium text-[#334155] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Fechar
              </button>
            )}
          </div>
        </div>

        {/* Accents strip */}
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {ACCENT_AND_SYMBOLS.map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => handleCharKey(sym)}
              className="inline-flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 text-sm font-semibold text-[#0F172A] active:scale-95 hover:bg-[#EFF6FF] cursor-pointer"
            >
              {sym}
            </button>
          ))}
        </div>

        {/* QWERTY Keycap Grid */}
        <div className="space-y-1.5 select-none">
          <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
            {NUMBER_ROW.map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleCharKey(num)}
                className="flex min-h-[44px] items-center justify-center rounded-lg border border-[#CBD5E1] bg-white text-sm font-semibold text-[#0F172A] shadow-[0_1px_0_#CBD5E1] active:translate-y-[1px] hover:bg-[#F8FAFC] cursor-pointer"
              >
                {num}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
            {ROW_1.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => handleCharKey(ch)}
                className="flex min-h-[46px] items-center justify-center rounded-lg border border-[#CBD5E1] bg-white text-base font-semibold text-[#0F172A] shadow-[0_1px_0_#CBD5E1] active:translate-y-[1px] hover:bg-[#F8FAFC] cursor-pointer"
              >
                {shiftActive ? ch.toUpperCase() : ch}
              </button>
            ))}
          </div>

          <div
            className={`grid gap-1 sm:gap-1.5 ${
              row2Keys.length === 10 ? 'grid-cols-10' : 'grid-cols-9 px-2 sm:px-4'
            }`}
          >
            {row2Keys.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => handleCharKey(ch)}
                className="flex min-h-[46px] items-center justify-center rounded-lg border border-[#CBD5E1] bg-white text-base font-semibold text-[#0F172A] shadow-[0_1px_0_#CBD5E1] active:translate-y-[1px] hover:bg-[#F8FAFC] cursor-pointer"
              >
                {shiftActive ? ch.toUpperCase() : ch}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
            <button
              type="button"
              aria-pressed={shiftActive}
              onClick={() => setShiftActive((v) => !v)}
              className={`col-span-2 flex min-h-[46px] items-center justify-center rounded-lg border text-xs font-bold active:scale-[0.97] cursor-pointer ${
                shiftActive
                  ? 'border-[#1D4ED8] bg-[#1D4ED8] text-white'
                  : 'border-[#CBD5E1] bg-[#E2E8F0] text-[#0F172A]'
              }`}
            >
              Shift
            </button>
            {ROW_3.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => handleCharKey(ch)}
                className="flex min-h-[46px] items-center justify-center rounded-lg border border-[#CBD5E1] bg-white text-base font-semibold text-[#0F172A] shadow-[0_1px_0_#CBD5E1] active:translate-y-[1px] hover:bg-[#F8FAFC] cursor-pointer"
              >
                {shiftActive ? ch.toUpperCase() : ch}
              </button>
            ))}
            <button
              type="button"
              aria-label="Apagar"
              onClick={() => handleSpecialKey('Backspace', HID_KEY.BACKSPACE)}
              className="flex min-h-[46px] items-center justify-center rounded-lg border border-[#CBD5E1] bg-[#E2E8F0] text-[#0F172A] active:scale-[0.97] cursor-pointer"
            >
              <Delete className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-12 gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={() => handleSpecialKey('Escape', HID_KEY.ESCAPE)}
              className="col-span-2 flex min-h-[48px] items-center justify-center rounded-lg border border-[#CBD5E1] bg-[#F1F5F9] text-xs font-semibold text-[#334155] active:scale-95 cursor-pointer"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={() => handleSpecialKey(' ', HID_KEY.SPACE)}
              className="col-span-5 flex min-h-[48px] items-center justify-center rounded-lg border border-[#CBD5E1] bg-white text-xs font-semibold text-[#475569] shadow-[0_1px_0_#CBD5E1] active:translate-y-[1px] cursor-pointer"
            >
              Espaço
            </button>
            <button
              type="button"
              aria-label="Seta esquerda"
              onClick={() => handleSpecialKey('ArrowLeft', HID_KEY.LEFT)}
              className="col-span-1 flex min-h-[48px] items-center justify-center rounded-lg border border-[#CBD5E1] bg-[#F1F5F9] text-[#0F172A] active:scale-95 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="col-span-1 flex flex-col gap-0.5">
              <button
                type="button"
                aria-label="Seta cima"
                onClick={() => handleSpecialKey('ArrowUp', HID_KEY.UP)}
                className="flex h-[23px] items-center justify-center rounded border border-[#CBD5E1] bg-[#F1F5F9] text-[#0F172A] active:scale-95 cursor-pointer"
              >
                <ArrowUp className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Seta baixo"
                onClick={() => handleSpecialKey('ArrowDown', HID_KEY.DOWN)}
                className="flex h-[23px] items-center justify-center rounded border border-[#CBD5E1] bg-[#F1F5F9] text-[#0F172A] active:scale-95 cursor-pointer"
              >
                <ArrowDown className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              aria-label="Seta direita"
              onClick={() => handleSpecialKey('ArrowRight', HID_KEY.RIGHT)}
              className="col-span-1 flex min-h-[48px] items-center justify-center rounded-lg border border-[#CBD5E1] bg-[#F1F5F9] text-[#0F172A] active:scale-95 cursor-pointer"
            >
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => handleSpecialKey('Enter', HID_KEY.ENTER)}
              className="col-span-2 flex min-h-[48px] items-center justify-center gap-1 rounded-lg bg-[#0F172A] text-xs font-semibold text-white active:scale-[0.98] cursor-pointer"
            >
              <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
