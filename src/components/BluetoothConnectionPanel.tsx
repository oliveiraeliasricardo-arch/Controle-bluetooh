import {
  Bluetooth,
  BluetoothConnected,
  Check,
  Eye,
  LogOut,
  Monitor,
  RefreshCw,
  Settings,
  Tv,
} from 'lucide-react';
import type { BluetoothDeviceInfo, BluetoothStatusInfo } from '../native/bluetoothHidPlugin';
import type { ActiveTransport } from '../hooks/useBluetoothKeyboard';
import type { DiscoveredTvDevice } from '../types/tv';

interface BluetoothConnectionPanelProps {
  nativeApp: boolean;
  btStatus: BluetoothStatusInfo;
  devices: BluetoothDeviceInfo[];
  webBtDevices: Array<{ id: string; name: string }>;
  companionTvs: DiscoveredTvDevice[];
  scanningBt: boolean;
  connectingAddress: string | null;
  activeTransport: ActiveTransport;
  connectedTargetName: string | null;
  pendingTvName: string | null;
  feedback: string | null;
  onRequestReady: () => void;
  onMakeDiscoverable: () => void;
  onScan: () => void;
  onStopScan: () => void;
  onPairAndConnect: (device: BluetoothDeviceInfo) => void;
  onConnectWsTv: (tv: DiscoveredTvDevice) => void;
  onDisconnect: () => void;
  onOpenBtSettings: () => void;
  onOpenTvMode: () => void;
}

export function BluetoothConnectionPanel({
  nativeApp,
  btStatus,
  devices,
  webBtDevices,
  companionTvs,
  scanningBt,
  connectingAddress,
  activeTransport,
  connectedTargetName,
  pendingTvName,
  feedback,
  onRequestReady,
  onMakeDiscoverable,
  onScan,
  onStopScan,
  onPairAndConnect,
  onConnectWsTv,
  onDisconnect,
  onOpenBtSettings,
  onOpenTvMode,
}: BluetoothConnectionPanelProps) {
  const isConnected = activeTransport !== 'none';

  return (
    <section
      aria-label="Conexão Bluetooth com a TV"
      className="rounded-2xl border border-[#E2E8F0] bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isConnected
                ? 'bg-[#ECFDF5] text-[#047857]'
                : 'bg-[#EFF6FF] text-[#1D4ED8]'
            }`}
          >
            {isConnected ? (
              <BluetoothConnected className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Bluetooth className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base font-bold text-[#0F172A] truncate">
              {isConnected ? connectedTargetName : 'Conectar na TV via Bluetooth'}
            </h2>
            <p className="text-xs text-[#475569]">
              {activeTransport === 'bluetooth_hid'
                ? 'Conectado via Bluetooth'
                : activeTransport === 'wifi_tv_mode'
                  ? 'Conectado no Modo TV'
                  : nativeApp
                    ? btStatus.enabled
                      ? 'Bluetooth ligado · Escolha sua TV'
                      : 'Ative o Bluetooth para conectar'
                    : 'No navegador, teste com Modo TV · No Android APK, conecta direto no Bluetooth'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isConnected ? (
            <button
              type="button"
              onClick={onDisconnect}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#CBD5E1] bg-white px-3.5 text-sm font-medium text-[#334155] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Desconectar
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={scanningBt ? onStopScan : onScan}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#1D4ED8] px-4 text-sm font-semibold text-white hover:bg-[#1E40AF] active:scale-[0.98] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw
                  className={`h-4 w-4 ${scanningBt ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {scanningBt ? 'Parar' : 'Procurar TV'}
              </button>

              {nativeApp ? (
                <button
                  type="button"
                  onClick={onMakeDiscoverable}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#CBD5E1] bg-white px-3.5 text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Eye className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
                  Ficar visível
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenTvMode}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#CBD5E1] bg-white px-3.5 text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Tv className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
                  Abrir Modo TV
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {nativeApp && (!btStatus.hasPermissions || !btStatus.enabled) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3">
          <span className="text-xs font-medium text-[#1E3A8A]">
            {!btStatus.hasPermissions
              ? 'Autorize o uso do Bluetooth para conectar na TV.'
              : 'Ligue o Bluetooth do celular para continuar.'}
          </span>
          <button
            type="button"
            onClick={onRequestReady}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#1D4ED8] px-3.5 text-xs font-semibold text-white hover:bg-[#1E40AF] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Bluetooth className="h-3.5 w-3.5" aria-hidden="true" />
            Ativar Bluetooth
          </button>
        </div>
      )}

      {nativeApp && !isConnected && devices.length > 0 && (
        <div className="mt-3 border-t border-[#F1F5F9] pt-2.5">
          <div className="flex items-center justify-between gap-2 pb-1">
            <span className="text-xs font-medium text-[#64748B] tabular-nums">
              Dispositivos ({devices.length})
            </span>
            <button
              type="button"
              onClick={onOpenBtSettings}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#1D4ED8] hover:underline whitespace-nowrap cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              Ajustes
            </button>
          </div>
          <ul className="divide-y divide-[#F1F5F9]">
            {devices.map((dev) => {
              const isBusy = connectingAddress === dev.address;
              return (
                <li
                  key={dev.address}
                  className="flex min-h-[50px] items-center justify-between gap-3 py-1.5"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {dev.isTv ? (
                      <Tv className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                    ) : (
                      <Monitor className="h-4 w-4 shrink-0 text-[#64748B]" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#0F172A]">
                        {dev.name}
                      </p>
                      <p className="truncate font-mono text-[11px] text-[#64748B] tabular-nums">
                        {dev.address} · {dev.bondState === 'bonded' ? 'Pareada' : 'Disponível'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onPairAndConnect(dev)}
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs font-semibold text-[#0F172A] hover:bg-[#F8FAFC] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {dev.connected ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#047857]" aria-hidden="true" />
                        Ativa
                      </>
                    ) : isBusy ? (
                      'Conectando...'
                    ) : dev.bondState === 'bonded' ? (
                      'Conectar'
                    ) : (
                      'Parear'
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!nativeApp && !isConnected && companionTvs.length > 0 && (
        <div className="mt-3 border-t border-[#F1F5F9] pt-2.5">
          <ul className="divide-y divide-[#F1F5F9]">
            {companionTvs.map((tv) => (
              <li
                key={tv.id}
                className="flex min-h-[48px] items-center justify-between gap-3 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Tv className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />
                  <span className="truncate text-sm font-semibold text-[#0F172A]">{tv.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onConnectWsTv(tv)}
                  className="inline-flex min-h-[38px] items-center rounded-lg bg-[#0F172A] px-3 text-xs font-semibold text-white hover:bg-[#1E293B] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Conectar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!nativeApp && webBtDevices.length > 0 && (
        <p className="mt-2.5 text-xs text-[#475569]">
          Bluetooth detectado: <strong>{webBtDevices[0].name}</strong> · Use o APK Android compilado no GitHub para digitar via Bluetooth HID.
        </p>
      )}

      {pendingTvName && (
        <p className="mt-2.5 text-xs text-[#1E3A8A]">
          Aceite a conexão na tela de {pendingTvName}...
        </p>
      )}

      {feedback && (
        <p role="status" className="mt-2.5 text-xs text-[#475569]">
          {feedback}
        </p>
      )}
    </section>
  );
}
