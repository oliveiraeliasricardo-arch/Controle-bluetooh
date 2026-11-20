export type PhoneBrandId = 'samsung' | 'iphone' | 'motorola' | 'xiaomi' | 'android';
export type TvBrandId =
  | 'samsung_tizen'
  | 'lg_webos'
  | 'android_tv'
  | 'roku'
  | 'chromecast'
  | 'firetv'
  | 'appletv'
  | 'browser_only';

export interface DeviceOption<T extends string> {
  id: T;
  name: string;
  subtitle: string;
}

export interface MirrorStep {
  id: string;
  title: string;
  detail: string;
  menuPath?: string;
}

export interface MirrorGuideResult {
  protocol: string;
  compatibility: 'Nativo sem app' | 'Requer app oficial' | 'Recomendado via Navegador';
  wifiRequirement: string;
  audioSupport: string;
  estimatedDelay: string;
  summary: string;
  steps: MirrorStep[];
  drmNote: string;
  suggestBrowserBridge: boolean;
}

export const PHONE_BRANDS: DeviceOption<PhoneBrandId>[] = [
  { id: 'samsung', name: 'Samsung Galaxy', subtitle: 'One UI · Smart View' },
  { id: 'iphone', name: 'iPhone / iPad', subtitle: 'iOS · AirPlay 2' },
  { id: 'motorola', name: 'Motorola', subtitle: 'Android · Transmitir' },
  { id: 'xiaomi', name: 'Xiaomi / Redmi / Poco', subtitle: 'HyperOS · MIUI' },
  { id: 'android', name: 'Outro Android', subtitle: 'Pixel · Asus · Realme' },
];

export const TV_BRANDS: DeviceOption<TvBrandId>[] = [
  { id: 'samsung_tizen', name: 'Samsung Smart TV', subtitle: 'Tizen (2018 ou mais nova)' },
  { id: 'lg_webos', name: 'LG Smart TV', subtitle: 'webOS · ThinQ' },
  { id: 'android_tv', name: 'Android TV / Google TV', subtitle: 'TCL · Sony · Philips · Semp' },
  { id: 'roku', name: 'Roku TV / Roku Express', subtitle: 'AOC · Philco · Semp' },
  { id: 'chromecast', name: 'Chromecast / Google TV', subtitle: 'Dongle HDMI Google' },
  { id: 'firetv', name: 'Amazon Fire TV Stick', subtitle: 'Fire OS · Miracast' },
  { id: 'appletv', name: 'Apple TV', subtitle: 'tvOS · AirPlay 2' },
  { id: 'browser_only', name: 'TV mais antiga / Outra marca', subtitle: 'Sem espelhamento nativo' },
];

export function getMirrorGuide(phone: PhoneBrandId, tv: TvBrandId): MirrorGuideResult {
  // Browser-only TV fallback
  if (tv === 'browser_only') {
    return {
      protocol: 'Ponte Wi-Fi TelaLivre (Navegador)',
      compatibility: 'Recomendado via Navegador',
      wifiRequirement: 'Mesma rede Wi-Fi ou internet ativa',
      audioSupport: 'Áudio nativo em vídeos e câmera',
      estimatedDelay: 'Instantâneo para fotos e YouTube',
      summary:
        'TVs mais antigas ou sistemas proprietários (como Philco/Multilaser Linux) não reconhecem Miracast ou AirPlay. Abrir o Receptor TV no navegador da TV permite conexão automática na lista Wi-Fi, sem códigos e sem adaptadores.',
      steps: [
        {
          id: 'b1',
          title: 'Conecte a TV na rede Wi-Fi da casa',
          detail: 'Confirme nas configurações de rede da TV que o Wi-Fi está conectado e com sinal estável.',
          menuPath: 'Menu da TV > Rede > Conexão Wi-Fi',
        },
        {
          id: 'b2',
          title: 'Abra o navegador de internet da TV',
          detail: 'Procure pelo aplicativo "Navegador", "Internet" ou "Web Browser" no menu principal da TV.',
        },
        {
          id: 'b3',
          title: 'Abra o Receptor TV do TelaLivre na televisão',
          detail: 'A TV se anuncia automaticamente na rede Wi-Fi pelo nome e marca, sem gerar códigos ou QR Code.',
        },
        {
          id: 'b4',
          title: 'Toque no nome da TV na lista do celular',
          detail: 'Na aba "Espelhar na TV" deste celular, toque diretamente na sua TV para conectar na hora.',
        },
        {
          id: 'b5',
          title: 'Inicie o espelhamento em tempo real',
          detail: 'Espelhe a tela, câmera, fotos ou vídeos do YouTube direto na televisão em baixa latência.',
        },
      ],
      drmNote:
        'Para Netflix, Globoplay ou Prime Video em TVs antigas, prefira usar o aplicativo nativo da TV quando disponível ou um Chromecast / Roku.',
      suggestBrowserBridge: true,
    };
  }

  // iPhone pairings
  if (phone === 'iphone') {
    if (tv === 'samsung_tizen' || tv === 'lg_webos' || tv === 'roku' || tv === 'appletv') {
      const tvMenuMap: Record<'samsung_tizen' | 'lg_webos' | 'roku' | 'appletv', string> = {
        samsung_tizen: 'Configurações > Geral > Configurações do Apple AirPlay > Ativado',
        lg_webos: 'Painel Casa (Home Dashboard) > AirPlay > Configurações de AirPlay e HomeKit',
        roku: 'Configurações > Apple AirPlay e HomeKit > AirPlay: Ligado',
        appletv: 'Ajustes > AirPlay e HomeKit > AirPlay: Ativado',
      };

      const tvLabelMap: Record<'samsung_tizen' | 'lg_webos' | 'roku' | 'appletv', string> = {
        samsung_tizen: 'Samsung (modelos 2018 em diante)',
        lg_webos: 'LG webOS (modelos 2019 em diante)',
        roku: 'Roku TV / Roku Express 4K',
        appletv: 'Apple TV',
      };

      return {
        protocol: 'Apple AirPlay 2 via Wi-Fi',
        compatibility: 'Nativo sem app',
        wifiRequirement: 'Mesma rede Wi-Fi (5 GHz recomendado)',
        audioSupport: 'Áudio e vídeo sincronizados',
        estimatedDelay: 'Baixa latência (cerca de 80–150 ms)',
        summary: `Seu iPhone conecta nativamente na ${tvLabelMap[tv]} usando AirPlay 2 pela rede Wi-Fi, sem instalar nenhum aplicativo extra.`,
        steps: [
          {
            id: 'ip1',
            title: 'Confirme que ambos estão no mesmo Wi-Fi',
            detail: 'Evite conectar o iPhone na rede 5G e a TV na rede "Convidados" ou em um repetidor com sub-rede isolada.',
            menuPath: 'Ajustes > Wi-Fi',
          },
          {
            id: 'ip2',
            title: 'Ative o AirPlay na TV',
            detail: 'Garanta que o recurso AirPlay esteja habilitado nas configurações da televisão.',
            menuPath: tvMenuMap[tv],
          },
          {
            id: 'ip3',
            title: 'Abra a Central de Controle no iPhone',
            detail: 'Deslize o dedo para baixo a partir do canto superior direito da tela (ou de baixo para cima em iPhones com botão físico).',
          },
          {
            id: 'ip4',
            title: 'Toque em "Espelhar Tela" (ícone de duas telas)',
            detail: 'Aguarde 3 a 5 segundos até o nome da sua TV aparecer na lista de dispositivos Wi-Fi.',
            menuPath: 'Central de Controle > Espelhar Tela',
          },
          {
            id: 'ip5',
            title: 'Digite o código de 4 dígitos exibido na TV',
            detail: 'Na primeira conexão, a TV mostrará um código PIN de 4 números. Insira no iPhone para concluir o pareamento.',
          },
        ],
        drmNote:
          'Se a tela ficar preta ao abrir Netflix ou Globoplay durante o espelhamento, toque no ícone de AirPlay ou Cast dentro do próprio player do vídeo em vez de espelhar a tela inteira.',
        suggestBrowserBridge: false,
      };
    }

    // iPhone + Chromecast / Android TV / Fire TV (no native AirPlay)
    return {
      protocol: 'Google Cast (em apps) ou Ponte Navegador',
      compatibility: tv === 'firetv' ? 'Recomendado via Navegador' : 'Requer app oficial',
      wifiRequirement: 'Mesma rede Wi-Fi sem VPN ativa',
      audioSupport: 'Áudio completo em apps compatíveis',
      estimatedDelay: 'Variável conforme o app',
      summary:
        'O iPhone usa AirPlay, enquanto Android TV, Chromecast e Fire TV não possuem AirPlay nativo de fábrica. Para YouTube, Netflix e Globoplay use o botão Cast dentro do app; para fotos, apresentações ou câmera, use o Modo TV do TelaLivre agora mesmo.',
      steps: [
        {
          id: 'ipc1',
          title: 'Conecte o iPhone e a TV no mesmo Wi-Fi',
          detail: 'Desative VPNs (como iCloud Private Relay ou VPN corporativa) caso a TV não seja localizada.',
          menuPath: 'Ajustes > Wi-Fi',
        },
        {
          id: 'ipc2',
          title: 'Autorize acesso à "Rede Local" no iOS',
          detail: 'O iPhone bloqueia descoberta de TVs se a permissão de Rede Local estiver desligada para o app que você está usando.',
          menuPath: 'Ajustes > Privacidade e Segurança > Rede Local',
        },
        {
          id: 'ipc3',
          title: 'Para vídeos (YouTube, Globoplay, Disney+)',
          detail: 'Abra o aplicativo no iPhone e toque no ícone de tela com ondas Wi-Fi (Transmitir/Cast) no canto superior direito.',
        },
        {
          id: 'ipc4',
          title: 'Para espelhamento sem instalar apps pagos',
          detail: 'Abra o Receptor TV no navegador da TV (ou Silk no Fire TV) e toque no nome da TV na lista do TelaLivre no Safari para conectar sem código.',
        },
      ],
      drmNote:
        'A Apple bloqueia espelhamento integral da tela para Chromecast sem apps intermediários. Usar o ícone Cast dentro de cada streaming oferece qualidade 4K real sem travar.',
      suggestBrowserBridge: true,
    };
  }

  // Android + Apple TV
  if (tv === 'appletv') {
    return {
      protocol: 'Ponte Wi-Fi TelaLivre ou Apps com Cast',
      compatibility: 'Recomendado via Navegador',
      wifiRequirement: 'Mesma rede Wi-Fi',
      audioSupport: 'Áudio nativo em mídia transmitida',
      estimatedDelay: 'Instantâneo para mídia',
      summary:
        'A Apple TV aceita apenas AirPlay de forma nativa e não possui receptor Miracast/Google Cast. Para vídeos, use o YouTube com pareamento por código da TV; para fotos e textos, use a ponte Wi-Fi do TelaLivre.',
      steps: [
        {
          id: 'aa1',
          title: 'Verifique a rede Wi-Fi nos dois aparelhos',
          detail: 'Certifique-se de que seu Android e a Apple TV estão na mesma rede residencial.',
        },
        {
          id: 'aa2',
          title: 'Para vídeos do YouTube na Apple TV',
          detail: 'Abra o YouTube na Apple TV > Configurações > Vincular com código da TV e digite o código no app YouTube do celular.',
          menuPath: 'YouTube na TV > Configurações > Vincular com código da TV',
        },
        {
          id: 'aa3',
          title: 'Para espelhar fotos, links ou apresentações',
          detail: 'Caso sua TV principal também seja Smart TV, abra o Receptor TV no navegador da televisão e selecione a TV direto na lista Wi-Fi sem digitar códigos.',
        },
      ],
      drmNote:
        'A Apple TV não oferece suporte nativo a espelhamento de tela Android. Evite aplicativos de terceiros cheios de anúncios que pedem assinatura para AirPlay.',
      suggestBrowserBridge: true,
    };
  }

  // Android + Chromecast / Android TV / Google TV
  if (tv === 'chromecast' || tv === 'android_tv') {
    const phoneStep =
      phone === 'samsung'
        ? {
            title: 'Abra o Google Home ou o Smart View (com suporte a Cast)',
            detail:
              'Em celulares Samsung, o Smart View prioriza Miracast. Para Android TV e Chromecast, o app Google Home garante conexão estável em 100% dos modelos.',
            menuPath: 'App Google Home > Dispositivos > Sua TV > Transmitir minha tela',
          }
        : phone === 'xiaomi'
          ? {
              title: 'Ative o recurso "Transmitir" na central de controle',
              detail:
                'Deslize a barra superior do Xiaomi e toque em "Transmitir" (ou acesse pelas configurações de conexão).',
              menuPath: 'Configurações > Mais opções de conectividade > Transmitir',
            }
          : {
              title: 'Toque em "Transmitir" no painel rápido do Android',
              detail:
                'Deslize duas vezes do topo da tela para baixo e toque no atalho "Transmitir" (ou "Espelhar tela").',
              menuPath: 'Configurações > Dispositivos conectados > Preferências de conexão > Transmitir',
            };

    return {
      protocol: 'Google Cast (Chromecast integrado)',
      compatibility: phone === 'samsung' ? 'Requer app oficial' : 'Nativo sem app',
      wifiRequirement: 'Mesma rede Wi-Fi (obrigatório)',
      audioSupport: 'Áudio e vídeo em Full HD',
      estimatedDelay: 'Baixa latência (cerca de 100–200 ms)',
      summary:
        'Excelente compatibilidade! Android TV, Google TV e Chromecast possuem receptor Google Cast nativo para espelhar toda a tela ou transmitir apps diretamente pela rede Wi-Fi.',
      steps: [
        {
          id: 'gc1',
          title: 'Conecte o celular e a TV exatamente na mesma rede Wi-Fi',
          detail: 'Se o roteador cria duas redes separadas (ex.: Casa_2G e Casa_5G), tente deixar ambos na rede 5 GHz para menor atraso.',
        },
        {
          id: 'gc2',
          title: 'Confirme o serviço "Chromecast integrado" na TV',
          detail: 'Na Android TV, o receptor já vem ligado de fábrica. Se não aparecer, reinicie a TV tirando da tomada por 15 segundos.',
          menuPath: 'Configurações da TV > Sistema > Transmitir',
        },
        {
          id: 'gc3',
          ...phoneStep,
        },
        {
          id: 'gc4',
          title: 'Selecione sua TV na lista e confirme "Iniciar agora"',
          detail: 'O Android exibirá um aviso de segurança informando que a tela será transmitida. Toque em "Iniciar agora".',
        },
        {
          id: 'gc5',
          title: 'Gire o celular na horizontal para tela cheia',
          detail: 'Ative a "Rotação automática" no celular para que vídeos e jogos preencham toda a largura da televisão.',
        },
      ],
      drmNote:
        'Para filmes na Netflix, Prime Video ou Globoplay, toque no ícone de transmissão (Cast) dentro do próprio aplicativo: a TV reproduz direto da internet sem gastar bateria do celular.',
      suggestBrowserBridge: false,
    };
  }

  // Android + Samsung Tizen / LG webOS / Roku / Fire TV (Miracast / Smart View / Screen Share)
  const tvSetupByBrand: Record<'samsung_tizen' | 'lg_webos' | 'roku' | 'firetv', MirrorStep> = {
    samsung_tizen: {
      id: 'tv-setup',
      title: 'Deixe a TV Samsung ligada no mesmo Wi-Fi',
      detail: 'Não é preciso abrir nenhum menu na TV; apenas aceite o pop-up "Permitir" com o controle remoto na primeira conexão.',
      menuPath: 'Configurações > Geral > Gerenciador de dispositivos externos > Gerenciador de conexão',
    },
    lg_webos: {
      id: 'tv-setup',
      title: 'Abra o "Compartilhamento de Tela" na LG',
      detail: 'Em modelos webOS recentes basta estar no mesmo Wi-Fi; em modelos mais antigos abra o app Screen Share / Compartilhar Tela.',
      menuPath: 'Botão Home > Painel Casa (Home Dashboard) > Compartilhar Tela',
    },
    roku: {
      id: 'tv-setup',
      title: 'Habilite o Espelhamento de Tela na Roku TV',
      detail: 'Garanta que o modo de espelhamento da Roku esteja configurado como "Perguntar" ou "Sempre permitir".',
      menuPath: 'Configurações > Sistema > Espelhamento de tela > Modo de espelhamento',
    },
    firetv: {
      id: 'tv-setup',
      title: 'Ative o modo de espelhamento no Fire TV Stick',
      detail: 'Segure o botão Home (casinha) no controle do Fire TV por 3 segundos e selecione "Espelhar".',
      menuPath: 'Segurar botão Home > Espelhar (ou Configurações > Tela e Som > Ativar espelhamento)',
    },
  };

  const isMotorola = phone === 'motorola';
  const phoneAction: MirrorStep =
    phone === 'samsung'
      ? {
          id: 'ph-act',
          title: 'Ative o "Smart View" no painel rápido',
          detail: 'Deslize o dedo do topo da tela do Galaxy para baixo e toque no botão "Smart View".',
          menuPath: 'Painel Rápido > Smart View > Selecione sua TV > Iniciar agora',
        }
      : phone === 'xiaomi'
        ? {
            id: 'ph-act',
            title: 'Ative "Tela sem fio" / "Transmitir" no Xiaomi',
            detail: 'Habilite o Wi-Fi e o Bluetooth para agilizar a descoberta da TV via Miracast.',
            menuPath: 'Configurações > Mais opções de conectividade > Tela sem fio > Ativar',
          }
        : isMotorola
          ? {
              id: 'ph-act',
              title: 'Atenção: maioria dos Motorola usa apenas Google Cast',
              detail:
                'Muitos modelos Moto G e Edge não trazem Miracast nativo (apenas Chromecast). Se a TV não aparecer em "Transmitir", use o app SmartThings (TV Samsung), LG ThinQ (TV LG) ou a Ponte Navegador do TelaLivre.',
              menuPath: 'Configurações > Dispositivos conectados > Transmitir',
            }
          : {
              id: 'ph-act',
              title: 'Ative "Tela sem fio" nas opções de Transmissão',
              detail: 'Acesse o menu Transmitir, toque nos três pontos no canto superior direito e marque "Ativar tela sem fio".',
              menuPath: 'Configurações > Dispositivos conectados > Transmitir > ⋮ > Ativar tela sem fio',
            };

  return {
    protocol: isMotorola
      ? 'App da Fabricante ou Ponte Wi-Fi TelaLivre'
      : phone === 'samsung'
        ? 'Smart View (Miracast / Wi-Fi Direct)'
        : 'Miracast / Tela sem fio via Wi-Fi',
    compatibility: isMotorola ? 'Requer app oficial' : 'Nativo sem app',
    wifiRequirement: 'Wi-Fi ligado no celular e na TV (mesma rede)',
    audioSupport: 'Áudio transmitido direto para a TV',
    estimatedDelay: 'Baixa latência (cerca de 70–150 ms)',
    summary: isMotorola
      ? 'Aparelhos Motorola mais recentes focam em Google Cast e frequentemente não listam TVs Miracast (Samsung, LG, Roku, Fire TV) no menu nativo. Você pode usar a Ponte Navegador TelaLivre agora mesmo ou o app da fabricante da TV.'
      : 'Seu celular e sua TV falam o mesmo protocolo sem fio via Wi-Fi. Basta ativar o espelhamento no painel rápido do celular e aceitar o convite na tela da TV.',
    steps: [
      {
        id: 'm1',
        title: 'Ligue o Wi-Fi nos dois aparelhos (sem economia extrema)',
        detail: 'Mesmo no Miracast via Wi-Fi Direct, o Wi-Fi do celular precisa estar ativado e sem VPN ligada.',
      },
      tvSetupByBrand[tv],
      phoneAction,
      {
        id: 'm4',
        title: 'Aceite a solicitação na tela da TV com o controle remoto',
        detail: 'Um aviso com o nome do seu celular aparecerá no canto superior da televisão. Selecione "Permitir".',
      },
      {
        id: 'm5',
        title: 'Ajuste a proporção da tela se necessário',
        detail: 'Ao virar o celular deitado, a imagem acompanha em tela cheia. Em celulares Samsung, toque no ícone flutuante do Smart View para ajustar a proporção.',
      },
    ],
    drmNote:
      'Apps pagos de streaming (Netflix, Globoplay, Max) bloqueiam a imagem durante o espelhamento de tela por proteção HDCP. Para assistir esses serviços, use o app instalado na própria TV ou o botão Cast.',
    suggestBrowserBridge: isMotorola,
  };
}
