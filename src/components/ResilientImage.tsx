import { useState } from 'react';
import { Tv } from 'lucide-react';

interface ResilientImageProps {
  src: string;
  alt: string;
  fallbackTitle: string;
  className?: string;
}

export function ResilientImage({
  src,
  alt,
  fallbackTitle,
  className = '',
}: ResilientImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#ECEFF4] via-[#F4F6F9] to-[#E2E8F0] p-6 text-center text-[#475467] ${className}`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#D0D5DD] bg-white text-[#1D4ED8]">
          <Tv className="h-5 w-5" aria-hidden="true" />
        </div>
        <span className="max-w-[20ch] text-sm font-medium text-[#344054]">{fallbackTitle}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
