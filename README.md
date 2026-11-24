# Caixas

Caixinhas para guardar o dinheiro das despesas que você precisa pagar: faturas, pessoas, contas.

Você adiciona numa caixinha o que precisa pagar e vai depositando nela o dinheiro do débito até cobrir. Quando paga, as despesas ficam como pagas e o dinheiro guardado sai da caixinha.

O app roda **inteiro no aparelho**: não tem servidor nem login e funciona sem internet. Os dados ficam guardados no navegador do próprio aparelho.

## Como funciona

- **Despesa:** o que você precisa pagar (fatura, pessoa, conta). O botão "Colar lista" aceita linhas como `SHEIN: 436,05`, e a linha `total:` serve para conferir a soma.
- **Depositar:** o dinheiro do débito que você guarda na caixinha.
- **Paguei:** as despesas passam para "já pagos" e o valor guardado sai da caixinha como retirada.
- **Retirar:** tira dinheiro da caixinha por outro motivo.

Não há divisão por mês: cada caixinha mostra quanto está guardado, quanto há para pagar e quanto falta guardar.

## Arquivos

- **`caixas.html`**: o app completo em um único arquivo, para abrir no computador ou no Android.
- **`docs/`**: a versão instalável, publicada no GitHub Pages. Funciona offline depois de aberta uma vez.
- **`public/`**: o código-fonte. Depois de mudar algo, rode `node build.js`.

## Instalar no iPhone

1. Abra https://chaungbr.github.io/caixas/ no **Safari**.
2. Toque em **Compartilhar → Adicionar à Tela de Início**.
3. Use sempre pelo ícone. O Safari e o ícone guardam dados separados.

## Backup

Os dados existem só no aparelho. Para não perder nada, use **Configurações → Fazer backup** de vez em quando e guarde o arquivo no app Arquivos ou no iCloud Drive. Para recuperar os dados, use **Restaurar**.
