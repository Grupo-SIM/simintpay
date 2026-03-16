export type PlanTipoDto = 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
export declare class CreatePlanDto {
    nome: string;
    descricao?: string;
    preco: number;
    tipo: PlanTipoDto;
    webhookUrl?: string;
    redirectUrl?: string;
}
