import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { KeyboardWorkspaceTab } from '../types/tv';
import { useBluetoothKeyboard } from '../hooks/useBluetoothKeyboard';
import { BluetoothConnectionPanel } from './BluetoothConnectionPanel';
import { KeyboardPanel } from './KeyboardPanel';
import { TrackpadPanel } from './TrackpadPanel';

interface BluetoothKeyboardWorkspaceProps {
  activeTab: KeyboardWorkspaceTab;
  onSelectTab: (tab: KeyboardWorkspaceTab) => void;
  onOpenTvMode: () => void;
}

export function BluetoothKeyboardWorkspace({
  activeTab,
  onSelectTab,
  onOpenTvMode,
}: BluetoothKeyboardWorkspaceProps) {
  const kb = useBluetoothKeyboard();
  const [mobileConnExpanded, setMobileConnExpanded] = useState(true);

  const isConnected = kb.activeTransport !== 'none';

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-3 py-4 pb-20 sm:px-6 sm:py-6 md:pb-8">
      <div className="space-y-4">
        {isConnected && (
          <div className="flex items-center justify-between md:hidden">
            <span className="text-xs font-medium text-[#475569]">
              TV: <strong className="text-[#0F172A]">{kb.connectedTargetName}</strong>
            </span>
            <button
              type="button"
              onClick={() => setMobileConnExpanded((v) => !v)}
              className="inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-[#1D4ED8] cursor-pointer"
            >
              {mobileConnExpanded ? (
                <>
                  Ocultar conexão
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                </>
              ) : (
                <>
                  Trocar TV
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        )}

        <div className={!isConnected || mobileConnExpanded ? 'block' : 'hidden md:block'}>
          <BluetoothConnectionPanel
            nativeApp={kb.nativeApp}
            btStatus={kb.btStatus}
            devices={kb.allNativeBtDevices}
            webBtDevices={kb.webBtDevices}
            companionTvs={kb.companionTvs}
            scanningBt={kb.scanningBt}
            connectingAddress={kb.connectingAddress}
            activeTransport={kb.activeTransport}
            connectedTargetName={kb.connectedTargetName}
            pendingTvName={kb.pendingTvName}
            feedback={kb.feedback}
            onRequestReady={kb.requestBluetoothReady}
            onMakeDiscoverable={kb.makePhoneDiscoverable}
            onScan={kb.scanBluetoothTvs}
            onStopScan={kb.stopBluetoothScan}
            onPairAndConnect={kb.pairAndConnectDevice}
            onConnectWsTv={kb.connectWsTv}
            onDisconnect={kb.disconnectCurrent}
            onOpenBtSettings={kb.openNativeBtSettings}
            onOpenTvMode={onOpenTvMode}
          />
        </div>

        {activeTab === 'keyboard' ? (
          <KeyboardPanel
            layout={kb.layout}
            hapticEnabled={kb.hapticEnabled}
            liveBuffer={kb.liveBuffer}
            recentInputs={kb.recentInputs}
            onChangeLayout={kb.setLayout}
            onToggleHaptic={kb.setHapticEnabled}
            onSendKey={kb.sendKey}
            onSendText={kb.sendText}
            onClearBuffer={kb.clearPreviewBuffer}
            onClose={() => onSelectTab('trackpad')}
          />
        ) : (
          <TrackpadPanel
            onMove={kb.sendMouseMove}
            onClick={kb.sendMouseClick}
            onOpenKeyboard={() => onSelectTab('keyboard')}
          />
        )}
      </div>
    </div>
  );
}
