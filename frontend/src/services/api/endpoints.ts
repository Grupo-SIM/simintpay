export const endpoints = {
  coproduction: {
    accounts: '/coproducao/contas',
    configuration: (product: string, id: string) =>
      `/coproducao/${encodeURIComponent(product)}/${encodeURIComponent(id)}`,
    receipts: '/coproducao/recebimentos',
  },
  auth: {
    login: '/auth/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    me: '/auth/me',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
  },
  leads: {
    create: '/leads',
  },
  afiliados: {
    me: '/afiliados/me',
  },
  transacoes: {
    list: '/transacoes',
    detail: (id: string) => `/transacoes/${id}`,
  },
  saque: {
    list: '/saques',
    create: '/saques',
    checkPending: '/saques/verificar-pendente',
    summary: '/saques/resumo',
    /** GET com Bearer: stream do arquivo (dono ou admin). */
    comprovante: (id: string) =>
      `/saques/${encodeURIComponent(id)}/comprovante`,
  },
  ofertas: {
    list: '/ofertas',
    create: '/ofertas',
    detail: (id: string) => `/ofertas/${encodeURIComponent(id)}`,
    update: (id: string) => `/ofertas/${encodeURIComponent(id)}`,
    deactivate: (id: string) => `/ofertas/${encodeURIComponent(id)}`,
    publicByCode: (code: string) =>
      `/ofertas/public/${encodeURIComponent(code)}`,
  },
  planos: {
    list: '/planos',
    create: '/planos',
    detail: (id: string) => `/planos/${id}`,
    update: (id: string) => `/planos/${id}`,
    delete: (id: string) => `/planos/${id}`,
    deactivate: (id: string) => `/planos/${id}/desativar`,
  },
  planosPix: {
    list: '/payments/pix-plan',
    create: '/payments/pix-plan',
    createCheckout: '/payments/pix-plan/checkout',
    createCheckoutByCode: '/payments/pix-plan/checkout-by-code',
    createLinkCode: (id: string) => `/payments/pix-plan/${id}/link-code`,
    detailByCode: (code: string) => `/payments/pix-plan/link-code/${code}`,
    checkoutDetailsByCode: (code: string) =>
      `/payments/pix-plan/link-code-details/${code}/checkout`,
    detail: (id: string) => `/payments/pix-plan/${id}`,
    update: (id: string) => `/payments/pix-plan/${id}`,
    delete: (id: string) => `/payments/pix-plan/${id}`,
    toggleStatus: (id: string) => `/bot/pix-plan/${id}/status`,
    accessList: '/payments/admin/pix-plan-access',
    accessToggle: (id: string) => `/bot/plan-access/${id}/status`,
  },
  assinantes: {
    list: '/assinantes',
    subscriptionDetail: (id: string) => `/assinantes/subscription/${id}`,
    cancel: (id: string) => `/assinantes/subscription/${id}/cancel`,
    removeHistory: (id: string) => `/assinantes/subscription/${id}/history`,
    pause: (id: string) => `/assinantes/subscription/${id}/pause`,
    resume: (id: string) => `/assinantes/subscription/${id}/resume`,
  },
  linksPagamento: {
    list: '/links-pagamento',
    create: '/links-pagamento',
    detail: (id: string) => `/links-pagamento/${id}`,
    update: (id: string) => `/links-pagamento/${id}`,
    delete: (id: string) => `/links-pagamento/${id}`,
    publicDetail: (id: string) => `/links-pagamento/public/${id}`,
    charge: (id: string) => `/links-pagamento/public/${id}/charge`,
    chargePix: (id: string) => `/links-pagamento/public/${id}/pix`,
    uploadFiles: (id: string) => `/links-pagamento/${id}/files`,
    deleteFile: (id: string, fileId: string) =>
      `/links-pagamento/${id}/files/${fileId}`,
    offers: (id: string) => `/links-pagamento/${id}/ofertas`,
    offerImage: (id: string) => `/links-pagamento/${id}/ofertas/imagem`,
    offerFiles: (id: string, offerId: string) =>
      `/links-pagamento/${id}/ofertas/${offerId}/arquivos`,
    deleteOfferFile: (id: string, offerId: string, fileId: string) =>
      `/links-pagamento/${id}/ofertas/${offerId}/arquivos/${fileId}`,
  },
  boletos: {
    list: '/boletos',
    create: '/boletos',
    detail: (id: string) => `/boletos/${id}`,
    update: (id: string) => `/boletos/${id}`,
    delete: (id: string) => `/boletos/${id}`,
  },
  linksAssinatura: {
    list: '/links-assinatura',
    create: '/links-assinatura',
    detail: (id: string) => `/links-assinatura/${id}`,
    update: (id: string) => `/links-assinatura/${id}`,
    delete: (id: string) => `/links-assinatura/${id}`,
    subscribers: (id: string) => `/links-assinatura/${id}/assinantes`,
    publicDetail: (code: string) => `/links-assinatura/public/${code}`,
    publicSubscribe: (code: string) =>
      `/links-assinatura/public/${code}/assinar`,
    publicPix: (code: string) => `/links-assinatura/public/${code}/pix`,
  },
  relatorios: {
    dashboard: '/relatorios/dashboard',
    dashboardRenovada: '/admin/plataformas/renovada/dashboard',
    dashboardRevalida: '/admin/plataformas/revalida/dashboard',
    dashboardCliente: '/admin/plataformas/cliente/dashboard',
    consolidado: '/admin/relatorios/consolidado',
    consolidadoTransacoes: '/admin/relatorios/consolidado/transacoes',
    taxaSaque: '/admin/relatorios/taxa-saque',
    lucroSaque: '/admin/relatorios/lucro-saque',
    totalRepasse: '/admin/relatorios/total-repasse',
    transacoesPorStatus: '/admin/relatorios/transacoes-por-status',
    transacoesPorMetodo: '/admin/relatorios/transacoes-por-metodo',
    quantidadeUsuariosExternos:
      '/admin/relatorios/quantidade-usuarios-externos',
    mensal: '/admin/relatorios/mensal',
    atlasConsolidado: '/admin/relatorios/atlas-consolidado',
    plataformaConsolidado: '/admin/relatorios/plataforma-consolidado',
  },
  revalida: {
    sales: '/dashboard/revalida/sales',
    withdrawals: '/dashboard/revalida/withdrawals',
    summary: '/dashboard/revalida/summary',
    setup: '/dashboard/revalida/setup',
  },
  configuracoes: {
    perfil: '/configuracoes/perfil',
    documento: '/configuracoes/documento',
    senha: '/configuracoes/senha',
    taxas: '/configuracoes/taxas',
    email: '/configuracoes/email',
  },
  maquinetas: {
    list: '/maquinetas',
    sync: '/admin/sync/maquinetas',
  },
  admin: {
    leads: {
      list: '/admin/leads',
      approve: (id: string) => `/admin/leads/${id}/approve`,
      reject: (id: string) => `/admin/leads/${id}/reject`,
      deleteMany: '/admin/leads',
    },
    users: {
      list: '/admin/users',
    },
    saques: {
      list: '/admin/saques',
      approve: (id: string) => `/admin/saques/${id}/aprovar`,
      reject: (id: string) => `/admin/saques/${id}/rejeitar`,
      updateReceipt: (id: string) => `/admin/saques/${id}/comprovante`,
      toggleVisibilidade: (id: string) => `/admin/saques/${id}/visibilidade`,
    },
    acquirerWithdrawals: {
      list: '/admin/acquirer-withdrawals',
      create: '/admin/acquirer-withdrawals',
      update: (id: string) =>
        `/admin/acquirer-withdrawals/${encodeURIComponent(id)}`,
      remove: (id: string) =>
        `/admin/acquirer-withdrawals/${encodeURIComponent(id)}`,
    },
    transacoesDom: '/admin/transacoes-dom',
    maquinetas: '/admin/maquinetas',
    criarConta: '/admin/criar-conta',
    cobrancas: {
      clientes: '/admin/cobrancas/clientes',
      excluirCliente: (id: string) => `/admin/cobrancas/clientes/${id}`,
      debitar: '/admin/cobrancas/debitar',
      gerar: '/admin/cobrancas/gerar',
      historico: '/admin/cobrancas',
      minhas: '/admin/cobrancas/minhas',
      status: (id: string) => `/admin/cobrancas/${id}/status`,
    },
    plataformas: {
      list: '/admin/plataformas',
      transacoes: (tag: string) => `/admin/plataformas/${tag}/transacoes`,
      dashboard: (tag: string) => `/admin/plataformas/${tag}/dashboard`,
      saques: (tag: string) => `/admin/plataformas/${tag}/saques`,
      distribuicaoMetodo: (tag: string) =>
        `/admin/plataformas/${tag}/distribuicao-metodo`,
      atlasBreakdown: '/admin/plataformas/atlas/breakdown',
      /** Taxas por plataforma (equivalente às variáveis `{TAG}_*` do .env). */
      taxasList: '/admin/plataformas/taxas',
      taxasUpdate: (tag: string) =>
        `/admin/plataformas/taxas/${encodeURIComponent(tag)}`,
      taxasByTag: (tag: string) =>
        `/admin/plataformas/taxas/${encodeURIComponent(tag)}`,
      simintpayClientes: '/admin/plataformas/simintpay-clientes',
    },
    usuarios: {
      list: '/admin/usuarios',
      export: '/admin/usuarios/export',
      scan: '/admin/usuarios/scan',
      update: (id: string) => `/admin/usuarios/${id}`,
      delete: (id: string) => `/admin/usuarios/${id}`,
      reativar: (id: string) => `/admin/usuarios/${id}/reativar`,
      permanente: (id: string) => `/admin/usuarios/${id}/permanente`,
      acessarComo: (userId: string) => `/admin/usuarios/${userId}/acessar-como`,
      marcarEmpresa: (userId: string) =>
        `/admin/usuarios/${userId}/marcar-empresa`,
    },
    plataformasExternasDb: {
      listAll: '/admin/plataformas-externas/usuarios',
    },
    afiliados: {
      list: '/admin/afiliados',
      search: '/admin/afiliados/buscar',
      detail: (id: string) => `/admin/afiliados/${id}`,
      referrals: (id: string, platform: string) =>
        `/admin/afiliados/${id}/indicados?platform=${platform}`,
      setAffiliate: (id: string) => `/admin/afiliados/${id}`,
      setReferredBy: (id: string) => `/admin/afiliados/indicacao/${id}`,
    },
    clientes: {
      list: '/admin/clientes',
      planos: '/admin/clientes/planos',
      planosPix: '/admin/clientes/planos-pix',
      linksPagamento: '/admin/clientes/links-pagamento',
      linksAssinatura: '/admin/clientes/links-assinatura',
    },
    areaflix: {
      orders: '/admin/areaflix/orders',
    },
  },
  internalStats: {
    sellerStats: (tag: string) => `/admin/plataformas/${tag}/seller-stats`,
    sellersAtivos: (tag: string) => `/admin/plataformas/${tag}/sellers-ativos`,
    saldosResumo: `/admin/plataformas/saldos-resumo`,
  },
} as const;
