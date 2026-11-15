// Erro de regra da loja (dado inválido, produto que não existe...): a API responde {"erro": mensagem} com o status.
export class ErroLoja extends Error {
  constructor(
    mensagem: string,
    public status = 422,
  ) {
    super(mensagem);
  }
}
