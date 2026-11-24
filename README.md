# Caixas

Gerenciamento financeiro pessoal pelo método de caixinhas: todo real recebido ganha um destino.

## Como rodar

Requer **Node.js 22.5 ou superior** (usa o SQLite nativo do Node). Não há dependências para instalar.

```powershell
npm start
```

Abra http://localhost:3000, crie sua conta e escolha "Usar estrutura sugerida" ou crie suas caixas do zero.

- Porta: variável `PORT` (padrão 3000).
- Banco de dados: `data/caixas.db` (ou a pasta em `CAIXAS_DATA`). Faça backup copiando esse arquivo.

## Publicar na internet (Railway)

1. Em railway.com: **New Project → Deploy from GitHub repo** → escolha este repositório. O `Dockerfile` é usado automaticamente.
2. No serviço criado: **Settings → Volumes → Add Volume** com o caminho de montagem `/data` (é onde fica o banco; sem isso os dados se perdem a cada atualização).
3. **Settings → Networking → Generate Domain** para ganhar um endereço `https://….up.railway.app`.
4. Abra o endereço no iPhone, crie sua conta e, no Safari, use **Compartilhar → Adicionar à Tela de Início**.

Cada `git push` publica uma nova versão automaticamente.

## Como o dinheiro é contado

| Conceito | Significado |
|---|---|
| **Receita total** | Salário + receitas extras + sobras liberadas no fechamento do mês anterior |
| **Reservado** | Quanto da receita do mês foi distribuído para a caixa |
| **Utilizado** | Gastos e pagamentos que saíram da caixa |
| **Saldo da caixa** | Saldo inicial + reservado + transferências recebidas − enviadas − utilizado |
| **Saldo financeiro atual** | Soma dos saldos das caixas + valor não distribuído |

- **Transferências** entre caixas mudam só o destino do dinheiro; o total não muda.
- **Cartões:** cada compra (à vista ou parcelada) entra na fatura do mês certo, conforme os dias de fechamento e vencimento. Só o **pagamento da fatura** sai do saldo de uma caixa, então nada é contado duas vezes. A categoria da compra serve apenas para os relatórios.
- **Fechamento do mês:** você escolhe o destino do saldo de cada caixa: manter na própria caixa, liberar como sobra ou enviar para outra caixa. Caixas de Acumulação e Meta mantêm o saldo automaticamente. Um mês fechado fica bloqueado para edição e pode ser reaberto.

## Estrutura

- `server.js`: servidor HTTP, API, autenticação (scrypt + cookie de sessão HttpOnly), banco SQLite e exportação CSV.
- `public/`: interface (HTML, CSS e JavaScript puros), com gráficos em SVG.

Todos os dados são isolados por usuário, e cada consulta filtra pelo usuário da sessão. Os valores são guardados em centavos (inteiros), para evitar erros de arredondamento.
