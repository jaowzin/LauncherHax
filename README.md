# LauncherHax

Launcher desktop para HaxBall com macros e keybinds configuráveis.

## Recursos atuais

- HaxBall oficial embutido em uma janela Electron.
- Sessão persistente do jogo.
- Macros salvas localmente no computador.
- Remapeamento de uma tecla para outra.
- Macro de mensagem no chat.
- Sequência simples de teclas com intervalo configurável.
- Ativar, desativar, editar e excluir macros.
- Build portátil para Windows x64.

> O launcher não redistribui nem modifica o cliente do HaxBall; ele carrega `haxball.com` dentro do Electron.

## Rodar localmente

```bash
npm install
npm start
```

## Build Windows x64

```bash
npm install
npm run package:win
npm run zip:win
```

O arquivo final fica em `release/LauncherHax-win-x64.zip`.

## Macros

As macros são ativadas quando o webview do jogo está focado.

- **Remapear tecla:** escolha a tecla de ativação e a tecla enviada ao jogo.
- **Chat:** pressiona Enter, insere o texto e pressiona Enter novamente.
- **Sequência:** informe códigos separados por vírgula, por exemplo `KeyW, KeyD, Space`.

## Aviso

Use macros de acordo com as regras das salas/servidores em que você joga.
