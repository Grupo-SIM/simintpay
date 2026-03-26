export class RenovadaDashboardResponseDto {
  profit: {
    total: number;
    maquinetas: number;
    offers: number;
    byPeriod: {
      labels: string[];
      data: number[];
    };
  };
  withdrawals: {
    today: number;
    sevenDays: number;
    fifteenDays: number;
    thirtyDays: number;
    annual: number;
  };
}
