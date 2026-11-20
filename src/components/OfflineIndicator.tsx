import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-md items-center gap-2.5 rounded-xl border border-[#F59E0B]/40 bg-[#101828] px-4 py-3 text-xs font-medium text-white shadow-lg pb-safe sm:left-4 sm:right-auto sm:mx-0"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-[#FBBF24]" aria-hidden="true" />
      <span>Sem conexão Wi-Fi — conecte-se à rede para procurar sua TV.</span>
    </div>
  );
}
