# Site CCM + banco FLECHA

## Como rodar
1. Instale o Node.js (v18+) e o MySQL.
2. Importe o banco (o arquivo usa DELIMITER, então use o terminal do MySQL ou o Workbench):
   `mysql -u root -p < FLECHA_TESTE_.sql`
3. Coloque o arquivo da logo em `public/logo.png`.
4. Na pasta do projeto:
   ```
   npm install
   DB_USER=root DB_PASSWORD=suasenha npm start      (Windows PowerShell: $env:DB_PASSWORD="suasenha"; npm start)
   ```
5. Abra http://localhost:3000

Variáveis opcionais: DB_HOST, DB_NAME (padrão `flecha`), PORT (padrão 3000).

## Contas de teste (vindas do SQL)
- gestor: marcia.gestora / gestor123
- professor: carolina.moraes / admin123
- aluno monitor: pedro.henrique / aluno123

## Permissões
| Função                              | Gestor | Aluno monitor | Professor |
|-------------------------------------|:------:|:-------------:|:---------:|
| Ver aparelhos, empréstimos, relatórios | ✔ | ✔ | ✔ |
| Registrar empréstimo / devolução    | ✔ | ✔ | — |
| Controlar carregamento              | ✔ | ✔ | — |
| Criar relatórios                    | ✔ | ✔ | — |
| Criar/editar/excluir aparelhos      | ✔ | — | — |
| Gerenciar usuários e cargos         | ✔ | — | — |

Criar conta pela tela de login sempre gera **aluno monitor**; só o gestor muda cargos.