// Configurações específicas para dispositivos mobile

export interface MobileConfig {
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  enableOfflineMode: boolean;
  enableProgressiveLoading: boolean;
}

export const getMobileConfig = (): MobileConfig => {
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
    );

  const isSlowConnection =
    typeof navigator !== 'undefined' &&
    ((navigator as Navigator & { connection?: { effectiveType: string } })
      .connection?.effectiveType === 'slow-2g' ||
      (navigator as Navigator & { connection?: { effectiveType: string } })
        .connection?.effectiveType === '2g');

  if (isMobile) {
    return {
      timeout: isSlowConnection ? 30000 : 20000, // 30s para conexões lentas, 20s para normais
      retryAttempts: isSlowConnection ? 5 : 3, // Mais tentativas para conexões lentas
      retryDelay: isSlowConnection ? 2000 : 1000, // Delay maior para conexões lentas
      enableOfflineMode: true,
      enableProgressiveLoading: true,
    };
  }

  // Configuração para desktop
  return {
    timeout: 15000,
    retryAttempts: 3,
    retryDelay: 1000,
    enableOfflineMode: false,
    enableProgressiveLoading: false,
  };
};

export const getNetworkInfo = () => {
  if (typeof navigator === 'undefined') return null;

  const connection =
    (
      navigator as Navigator & {
        connection?: {
          effectiveType: string;
          downlink: number;
          rtt: number;
          saveData: boolean;
        };
        mozConnection?: {
          effectiveType: string;
          downlink: number;
          rtt: number;
          saveData: boolean;
        };
        webkitConnection?: {
          effectiveType: string;
          downlink: number;
          rtt: number;
          saveData: boolean;
        };
      }
    ).connection ||
    (
      navigator as Navigator & {
        connection?: {
          effectiveType: string;
          downlink: number;
          rtt: number;
          saveData: boolean;
        };
        mozConnection?: {
          effectiveType: string;
          downlink: number;
          rtt: number;
          saveData: boolean;
        };
        webkitConnection?: {
          effectiveType: string;
          downlink: number;
          rtt: number;
          saveData: boolean;
        };
      }
    ).mozConnection ||
    (
      navigator as Navigator & {
        connection?: {
          effectiveType: string;
          downlink: number;
          rtt: number;
          saveData: boolean;
        };
        mozConnection?: {
          effectiveType: string;
          downlink: number;
          rtt: number;
          saveData: boolean;
        };
        webkitConnection?: {
          effectiveType: string;
          downlink: number;
          rtt: number;
          saveData: boolean;
        };
      }
    ).webkitConnection;

  if (connection) {
    return {
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt,
      saveData: connection.saveData,
    };
  }

  return null;
};

export const isLowBandwidth = (): boolean => {
  const networkInfo = getNetworkInfo();
  if (!networkInfo) return false;

  return (
    networkInfo.effectiveType === 'slow-2g' ||
    networkInfo.effectiveType === '2g' ||
    networkInfo.downlink < 1
  );
};

export const shouldUseProgressiveLoading = (): boolean => {
  return getMobileConfig().enableProgressiveLoading && isLowBandwidth();
};
