# TeclaTV — Teclado Bluetooth HID para Smart TV

Transforme seu celular Android em um **teclado Bluetooth físico (perfil HID)**, **controle remoto de mídia/D-Pad** e **touchpad sem fio** para conectar diretamente em Smart TVs (Samsung Tizen, LG webOS, Android TV / Google TV, Fire TV, Apple TV, Roku e PCs) — sem precisar instalar nada na TV.

---

## Como gerar o APK Android pelo GitHub (sem Android Studio)

Este repositório já inclui o plugin nativo `BluetoothHidPlugin.java` (`BluetoothHidDevice`), as permissões no `AndroidManifest.xml`, o projeto Capacitor (`android/`) e a automação em `.github/workflows/build-android-apk.yml`.

1. Envie todos os arquivos deste repositório para o seu GitHub na branch `main` (ou `master`).
2. No GitHub, abra a aba **Actions**.
3. Selecione o workflow **Gerar APK Android (TeclaTV Bluetooth)** (ou clique em **Run workflow**).
4. Ao terminar, role até **Artifacts**, baixe o arquivo **`TeclaTV-Bluetooth-APK`**, descompacte e instale o `app-debug.apk` no celular (Android 9 ou superior).

---

## Como conectar na Smart TV via Bluetooth

1. Abra o aplicativo **TeclaTV** no celular Android e conceda as permissões de Bluetooth.
2. Toque em **Ficar visível** (ou em **Procurar TV**).
3. Na Smart TV, acesse **Configurações > Bluetooth** (ou Dispositivos Externos > Teclado Bluetooth) e selecione o seu celular.
4. Após pareado, use as abas **Teclado**, **Controle** e **Touchpad** diretamente na TV.

---

## Modo Receptor TV (teste no navegador)

Para testar o teclado, envio de texto, botões de controle remoto e cursor do touchpad diretamente entre duas abas do navegador ou pela rede Wi-Fi:

```bash
npm install
npm run dev
```

Abra `http://localhost:3000/?modo=tv` na tela da TV (ou em outra aba) e conecte a partir da tela principal.
