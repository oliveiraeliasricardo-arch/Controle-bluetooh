import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Info,
  RotateCcw,
  Smartphone,
  Tv,
  Wifi,
} from 'lucide-react';
import {
  getMirrorGuide,
  PHONE_BRANDS,
  TV_BRANDS,
  type PhoneBrandId,
  type TvBrandId,
} from '../data/brandsGuide';
import type { AppSection } from '../types/tv';
import { ResilientImage } from './ResilientImage';

interface BrandGuideViewProps {
  onNavigate: (section: AppSection) => void;
}

export function BrandGuideView({ onNavigate }: BrandGuideViewProps) {
  const [selectedPhone, setSelectedPhone] = useState<PhoneBrandId>('samsung');
  const [selectedTv, setSelectedTv] = useState<TvBrandId>('samsung_tizen');
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});

  const guide = useMemo(
    () => getMirrorGuide(selectedPhone, selectedTv),
    [selectedPhone, selectedTv]
  );

  const comboKey = `${selectedPhone}:${selectedTv}`;

  const toggleStep = (stepId: string) => {
    const key = `${comboKey}:${stepId}`;
    setCompletedSteps((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const resetProgress = () => {
    setCompletedSteps((prev) => {
      const next = { ...prev };
      for (const step of guide.steps) {
        delete next[`${comboKey}:${step.id}`];
      }
      return next;
    });
  };

  const completedCount = guide.steps.filter(
    (step) => completedSteps[`${comboKey}:${step.id}`]
  ).length;

  const compatibilityColor =
    guide.compatibility === 'Nativo sem app'
      ? 'text-[#15803D]'
      : guide.compatibility === 'Requer app oficial'
        ? 'text-[#B45309]'
        : 'text-[#1D4ED8]';

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Intro Header */}
      <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
        <div className="flex flex-col justify-center space-y-3 lg:col-span-7">
          <p className="text-sm font-medium text-[#1D4ED8]">
            Assistente de configuração nativa por fabricante
          </p>
          <h1 className="font-display text-balance text-3xl font-bold leading-tight tracking-tight text-[#101828] sm:text-4xl">
            Passo a passo exato para o seu celular e sua TV
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-[#475467]">
            Cada fabricante usa um protocolo diferente de Wi-Fi (Smart View, AirPlay 2, Google Cast
            ou Miracast). Selecione abaixo seus dois aparelhos para ver o caminho exato nos menus.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#E4E7EC] bg-white lg:col-span-5">
          <ResilientImage
            src="/src/assets/images/guide_mirroring_setup_1795194198327.jpg"
            alt="Pessoa usando celular no sofá para conectar na Smart TV da sala"
            fallbackTitle="Configuração guiada de espelhamento sem fio"
            className="h-48 w-full object-cover sm:h-56 lg:h-full"
          />
        </div>
      </div>

      {/* Step 1 & 2 Selectors */}
      <section className="mt-10 grid grid-cols-1 gap-8 border-t border-[#E4E7EC] pt-8 lg:grid-cols-12">
        {/* Phone Selector */}
        <div className="lg:col-span-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#101828]">
            <Smartphone className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
            1. Qual é o seu celular?
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2">
            {PHONE_BRANDS.map((phone) => {
              const active = selectedPhone === phone.id;
              return (
                <button
                  key={phone.id}
                  type="button"
                  onClick={() => setSelectedPhone(phone.id)}
                  className={`flex min-h-[54px] items-center justify-between rounded-xl border px-4 py-2.5 text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-[#1D4ED8] bg-[#EFF6FF]/60 text-[#101828]'
                      : 'border-[#E4E7EC] bg-white text-[#344054] hover:border-[#D0D5DD] hover:bg-[#F9FAFB]'
                  }`}
                >
                  <div>
                    <div className="text-sm font-semibold text-[#101828]">{phone.name}</div>
                    <div className="text-xs text-[#667085]">{phone.subtitle}</div>
                  </div>
                  {active && <Check className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* TV Selector */}
        <div className="lg:col-span-7">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#101828]">
            <Tv className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
            2. Qual é a sua TV ou aparelho conectado nela?
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TV_BRANDS.map((tv) => {
              const active = selectedTv === tv.id;
              return (
                <button
                  key={tv.id}
                  type="button"
                  onClick={() => setSelectedTv(tv.id)}
                  className={`flex min-h-[58px] items-center justify-between rounded-xl border px-4 py-2.5 text-left transition-colors cursor-pointer ${
                    active
                      ? 'border-[#1D4ED8] bg-[#EFF6FF]/60 text-[#101828]'
                      : 'border-[#E4E7EC] bg-white text-[#344054] hover:border-[#D0D5DD] hover:bg-[#F9FAFB]'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="truncate text-sm font-semibold text-[#101828]">{tv.name}</div>
                    <div className="truncate text-xs text-[#667085]">{tv.subtitle}</div>
                  </div>
                  {active && <Check className="h-4 w-4 shrink-0 text-[#1D4ED8]" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Personalized Mirroring Playbook */}
      <section className="mt-10 rounded-2xl border border-[#E4E7EC] bg-white p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E4E7EC] pb-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#475467]">
              <span className={`font-semibold ${compatibilityColor}`}>{guide.compatibility}</span>
              <span aria-hidden="true">·</span>
              <span>{guide.wifiRequirement}</span>
              <span aria-hidden="true">·</span>
              <span>{guide.audioSupport}</span>
            </div>
            <h2 className="font-display text-2xl font-bold text-[#101828]">{guide.protocol}</h2>
            <p className="max-w-3xl text-sm leading-relaxed text-[#475467]">{guide.summary}</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-semibold text-[#344054] tabular-nums">
              {completedCount} de {guide.steps.length} feitos
            </span>
            {completedCount > 0 && (
              <button
                type="button"
                onClick={resetProgress}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#D0D5DD] bg-white px-3 py-1.5 text-xs font-medium text-[#475467] hover:text-[#101828] whitespace-nowrap cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reiniciar
              </button>
            )}
          </div>
        </div>

        {/* Interactive Step Checklist */}
        <ol className="mt-2 divide-y divide-[#E4E7EC]">
          {guide.steps.map((step, index) => {
            const done = Boolean(completedSteps[`${comboKey}:${step.id}`]);
            return (
              <li key={step.id} className="py-4">
                <button
                  type="button"
                  onClick={() => toggleStep(step.id)}
                  className="group flex w-full items-start gap-4 text-left cursor-pointer"
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold tabular-nums transition-colors ${
                      done
                        ? 'border-[#15803D] bg-[#15803D] text-white'
                        : 'border-[#D0D5DD] bg-[#F9FAFB] text-[#344054] group-hover:border-[#1D4ED8]'
                    }`}
                  >
                    {done ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}
                  </span>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div
                      className={`text-base font-semibold transition-colors ${
                        done ? 'text-[#667085] line-through' : 'text-[#101828]'
                      }`}
                    >
                      {step.title}
                    </div>
                    <p className="text-sm leading-relaxed text-[#475467]">{step.detail}</p>
                    {step.menuPath && (
                      <p className="pt-0.5 font-mono text-xs text-[#1D4ED8]">
                        Caminho: {step.menuPath}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>

        {/* DRM Note + Bridge CTA */}
        <div className="mt-6 flex flex-col justify-between gap-5 border-t border-[#E4E7EC] pt-6 md:flex-row md:items-center">
          <div className="flex max-w-2xl items-start gap-3 text-sm text-[#475467]">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#667085]" aria-hidden="true" />
            <p className="leading-relaxed">{guide.drmNote}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('diagnostics')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#D0D5DD] bg-white px-4 py-2 text-sm font-medium text-[#344054] hover:bg-[#F9FAFB] whitespace-nowrap cursor-pointer"
            >
              <Wifi className="h-4 w-4" aria-hidden="true" />
              TV não apareceu?
            </button>

            <button
              type="button"
              onClick={() => onNavigate('pair')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1D4ED8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E40AF] whitespace-nowrap cursor-pointer"
            >
              {guide.suggestBrowserBridge
                ? 'Conectar pelo Receptor TV'
                : 'Escolher TV na rede Wi-Fi'}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
