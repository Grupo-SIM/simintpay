export declare enum Faturamento {
    ATE_10K = "ATE_10K",
    DE_10K_A_50K = "DE_10K_A_50K",
    DE_50K_A_100K = "DE_50K_A_100K",
    DE_100K_A_500K = "DE_100K_A_500K",
    ACIMA_500K = "ACIMA_500K"
}
export declare enum TempoOperacao {
    MENOS_1_ANO = "MENOS_1_ANO",
    DE_1_A_3_ANOS = "DE_1_A_3_ANOS",
    DE_3_A_5_ANOS = "DE_3_A_5_ANOS",
    MAIS_5_ANOS = "MAIS_5_ANOS"
}
export declare enum ModeloOperacao {
    ECOMMERCE = "ECOMMERCE",
    PRESENCIAL = "PRESENCIAL",
    AMBOS = "AMBOS",
    SERVICOS = "SERVICOS",
    ASSINATURAS = "ASSINATURAS"
}
export declare enum CargoEmpresa {
    SOCIO = "SOCIO",
    DIRETOR = "DIRETOR",
    GERENTE = "GERENTE",
    FINANCEIRO = "FINANCEIRO",
    TI = "TI",
    OUTRO = "OUTRO"
}
export declare class CreateLeadDto {
    name: string;
    phone: string;
    email: string;
    razaoSocial: string;
    cnpj: string;
    faturamento: Faturamento;
    tempoOperacao: TempoOperacao;
    modeloOperacao?: ModeloOperacao;
    cargo: CargoEmpresa;
    comoConheceu?: string;
}
