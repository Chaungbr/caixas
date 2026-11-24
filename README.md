# Caixas

Gerenciamento financeiro pessoal pelo método de caixinhas: todo real recebido ganha um destino.

O app roda **inteiro no aparelho**: não tem servidor nem login e funciona sem internet. Os dados ficam guardados no navegador do próprio aparelho.

## Arquivos

- **`caixas.html`**: o app completo em um único arquivo. No computador ou no Android, basta abrir esse arquivo no navegador.
- **`docs/`**: a versão para instalar no iPhone. Ela é publicada pelo GitHub Pages; depois de aberta uma vez, funciona offline e pode ir para a Tela de Início.
- **`public/`**: o código-fonte. Depois de mudar algo, rode `node build.js` para gerar de novo o `caixas.html` e a pasta `docs/`.

## Instalar no iPhone

1. Abra o endereço do GitHub Pages no **Safari**. É preciso internet só nessa primeira vez.
2. Toque em **Compartilhar → Adicionar à Tela de Início**.
3. A partir daí, abra o Caixas pelo ícone. Ele funciona sem internet.

## Backup

Os dados existem só no aparelho em que foram criados. Para não perder nada:

- Use **Configurações → Fazer backup agora** de tempos em tempos e guarde o arquivo no app Arquivos ou no iCloud Drive. O app avisa quando o último backup tem mais de 14 dias.
- Para recuperar, ou para passar os dados para outro aparelho, use **Restaurar backup**.

## Como o dinheiro é contado

| Conceito | Significado |
|---|---|
| **Receita total** | Salário + receitas extras + sobras liberadas no fechamento do mês anterior |
| **Reservado** | Quanto da receita do mês foi distribuído para a caixa |
| **Utilizado** | Gastos e pagamentos que saíram da caixa |
| **Saldo da caixa** | Saldo inicial + reservado + transferências recebidas − enviadas − utilizado |
| **Saldo financeiro atual** | Soma dos saldos das caixas + valor não distribuído |

- **Transferências** entre caixas mudam só o destino do dinheiro; o total não muda.
- **Cartões:** cada compra (à vista ou parcelada) entra na fatura do mês certo, conforme os dias de fechamento e vencimento. Só o **pagamento da fatura** sai do saldo de uma caixa, então nada é contado duas vezes.
- **Fechamento do mês:** você escolhe o destino do saldo de cada caixa: manter na própria caixa, liberar como sobra ou enviar para outra caixa. Um mês fechado fica bloqueado para edição e pode ser reaberto.

Os valores são guardados em centavos (inteiros), para evitar erros de arredondamento.
