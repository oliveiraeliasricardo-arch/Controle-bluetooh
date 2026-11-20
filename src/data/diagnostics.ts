export interface TroubleshootItem {
  id: string;
  symptom: string;
  category: string;
  likelyCause: string;
  fixes: {
    title: string;
    detail: string;
  }[];
  canUseBridge: boolean;
}

export interface NetworkCheckItem {
  id: string;
  label: string;
  hint: string;
}

export const PREFLIGHT_CHECKS: NetworkCheckItem[] = [
  {
    id: 'same_ssid',
    label: 'Celular e TV estão no mesmo nome de rede Wi-Fi',
    hint: 'Se o roteador cria "Casa_2.4G" e "Casa_5G", coloque os dois no mesmo nome para evitar isolamento.',
  },
  {
    id: 'no_guest_wifi',
    label: 'Nenhum aparelho está na rede "Visitantes" / "Convidados"',
    hint: 'Redes de visitantes ativam isolamento de clientes (AP Isolation), impedindo que o celular enxergue a TV.',
  },
  {
    id: 'vpn_off',
    label: 'VPN e DNS privado estão desativados temporariamente',
    hint: 'Apps de VPN redirecionam o tráfego local e escondem dispositivos da sua sala.',
  },
  {
    id: 'tv_reboot',
    label: 'TV não está em espera profunda há semanas',
    hint: 'Tirar a TV da tomada por 20 segundos reinicia o módulo Wi-Fi e resolve 70% das falhas de descoberta.',
  },
];

export const TROUBLESHOOT_ITEMS: TroubleshootItem[] = [
  {
    id: 'tv_not_found',
    symptom: 'A TV não aparece na lista de busca do celular',
    category: 'Descoberta Wi-Fi',
    likelyCause: 'Bandas separadas (2.4 GHz vs 5 GHz), VPN ativa ou isolamento de dispositivos no roteador.',
    fixes: [
      {
        title: 'Confira se ambos estão na mesma rede e faixa',
        detail: 'Conecte o celular e a TV exatamente no mesmo SSID (por exemplo, ambos na rede 5 GHz). Evite repetidores configurados em modo roteador.',
      },
      {
        title: 'Desative VPN, economia de dados ou Private Relay',
        detail: 'No Android verifique Configurações > Rede > VPN. No iPhone confira Ajustes > VPN e ative "Rede Local" em Privacidade.',
      },
      {
        title: 'Reinicie o módulo Wi-Fi da TV na tomada',
        detail: 'Apenas desligar no controle remoto deixa a TV em standby. Retire o cabo da tomada por 20 segundos e ligue novamente.',
      },
      {
        title: 'Verifique AP Isolation / UPnP no roteador',
        detail: 'Em roteadores TP-Link, Intelbras ou operadoras (Vivo/Claro), desative "Isolamento de AP" e mantenha UPnP e Multicast/IGMP ativos.',
      },
    ],
    canUseBridge: true,
  },
  {
    id: 'black_screen_streaming',
    symptom: 'Espelha normal, mas fica tela preta na Netflix, Globoplay ou Prime Video',
    category: 'Proteção DRM',
    likelyCause: 'Proteção antipirataria HDCP/DRM bloqueia captura de tela nesses aplicativos.',
    fixes: [
      {
        title: 'Use o ícone "Transmitir / Cast" dentro do próprio vídeo',
        detail: 'Em vez de espelhar a tela inteira do celular, abra o vídeo no app de streaming e toque no ícone de TV com ondas Wi-Fi no canto do player.',
      },
      {
        title: 'Prefira o aplicativo instalado na própria Smart TV',
        detail: 'Você ainda pode usar o celular como controle remoto (ex.: parear o YouTube pelo código da TV) sem esbarrar no bloqueio DRM.',
      },
    ],
    canUseBridge: false,
  },
  {
    id: 'lag_and_freeze',
    symptom: 'Conecta, mas a imagem trava, fica borrada ou com muito atraso',
    category: 'Desempenho Wi-Fi',
    likelyCause: 'Interferência na rede 2.4 GHz, sinal fraco atrás da TV ou Bluetooth congestionando a faixa.',
    fixes: [
      {
        title: 'Mude a TV e o celular para a rede Wi-Fi 5 GHz',
        detail: 'A frequência 2.4 GHz sofre interferência de micro-ondas, telefones sem fio e Bluetooth. O Wi-Fi 5 GHz entrega largura de banda muito maior para vídeo.',
      },
      {
        title: 'Aproxime o roteador ou use cabo Ethernet na TV',
        detail: 'Mesmo com a TV ligada no cabo de rede do roteador, o celular no Wi-Fi consegue encontrá-la na mesma rede local e com metade da latência.',
      },
      {
        title: 'Ative o "Modo Jogo" na entrada da TV',
        detail: 'Reduz o pós-processamento de imagem da TV e corta drasticamente o atraso entre o toque no celular e o movimento na tela.',
      },
    ],
    canUseBridge: true,
  },
  {
    id: 'no_audio',
    symptom: 'A imagem aparece na TV, mas o som continua saindo no celular (ou mudo)',
    category: 'Áudio',
    likelyCause: 'Fone Bluetooth conectado ao celular, volume de mídia zerado ou modo silencioso.',
    fixes: [
      {
        title: 'Desconecte fones ou caixas Bluetooth do celular',
        detail: 'O Bluetooth costuma assumir prioridade sobre o áudio do espelhamento Wi-Fi.',
      },
      {
        title: 'Aumente o volume de Mídia nos botões laterais',
        detail: 'Alguns celulares Android transmitem o áudio proporcional ao volume de mídia local.',
      },
      {
        title: 'No Modo TV pelo navegador, toque no botão "Ativar som"',
        detail: 'Navegadores modernos exigem uma interação na tela da TV para liberar áudio de transmissões ao vivo.',
      },
    ],
    canUseBridge: false,
  },
  {
    id: 'iphone_android_tv',
    symptom: 'Tenho iPhone e minha TV Android / Samsung antiga não tem AirPlay',
    category: 'Incompatibilidade',
    likelyCause: 'O iPhone usa protocolo AirPlay 2 e não possui suporte nativo a Miracast.',
    fixes: [
      {
        title: 'Use a descoberta Wi-Fi direta do TelaLivre (sem código ou QR Code)',
        detail: 'Abra o Receptor TV no navegador da televisão e toque no nome da TV diretamente na lista do iPhone para transmitir fotos, YouTube, avisos ou câmera ao vivo sem instalar nada.',
      },
      {
        title: 'Use o botão Cast nativo em apps de streaming',
        detail: 'YouTube, Spotify, Globoplay e Netflix no iPhone reconhecem Android TV e Chromecast nativamente sem precisar de AirPlay.',
      },
    ],
    canUseBridge: true,
  },
  {
    id: 'motorola_no_miracast',
    symptom: 'Celular Motorola não encontra TV Samsung, LG ou Roku',
    category: 'Incompatibilidade',
    likelyCause: 'A maioria dos aparelhos Motorola desabilita Miracast e suporta apenas Google Cast.',
    fixes: [
      {
        title: 'Use a Ponte Navegador TelaLivre agora mesmo',
        detail: 'Funciona entre qualquer Motorola e o navegador de qualquer TV Samsung, LG ou genérica pela rede Wi-Fi.',
      },
      {
        title: 'Use o app oficial da TV para fotos e mídia local',
        detail: 'SmartThings (TVs Samsung), LG ThinQ (TVs LG) ou o app Roku oficial permitem enviar fotos e controlar a TV pelo Wi-Fi mesmo em celulares Motorola.',
      },
    ],
    canUseBridge: true,
  },
];
