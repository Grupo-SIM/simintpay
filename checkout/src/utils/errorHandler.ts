// Utilitário para tratamento de erros específicos para dispositivos mobile

export interface ErrorInfo {
  message: string;
  isRetryable: boolean;
  shouldShowUser: boolean;
  logLevel: 'info' | 'warn' | 'error';
}

export const handleMobileError = (error: any, context: string): ErrorInfo => {
  const errorMessage =
    error?.message || error?.toString() || 'Erro desconhecido';

  // Erros de rede/conectividade
  if (error?.name === 'AbortError' || errorMessage.includes('timeout')) {
    return {
      message:
        'Tempo limite excedido. Verifique sua conexão e tente novamente.',
      isRetryable: true,
      shouldShowUser: true,
      logLevel: 'warn',
    };
  }

  if (
    errorMessage.includes('fetch') ||
    errorMessage.includes('Failed to fetch')
  ) {
    return {
      message: 'Erro de conexão. Verifique sua internet e tente novamente.',
      isRetryable: true,
      shouldShowUser: true,
      logLevel: 'warn',
    };
  }

  if (
    errorMessage.includes('NetworkError') ||
    errorMessage.includes('ERR_NETWORK')
  ) {
    return {
      message: 'Problema de rede. Tente novamente em alguns instantes.',
      isRetryable: true,
      shouldShowUser: true,
      logLevel: 'warn',
    };
  }

  // Erros de API
  if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
    return {
      message: 'Sessão expirada. Recarregue a página e tente novamente.',
      isRetryable: false,
      shouldShowUser: true,
      logLevel: 'error',
    };
  }

  if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
    return {
      message: 'Acesso negado. Verifique suas permissões.',
      isRetryable: false,
      shouldShowUser: true,
      logLevel: 'error',
    };
  }

  if (
    errorMessage.includes('500') ||
    errorMessage.includes('Internal Server Error')
  ) {
    return {
      message: 'Erro interno do servidor. Tente novamente em alguns instantes.',
      isRetryable: true,
      shouldShowUser: true,
      logLevel: 'error',
    };
  }

  // Erros de validação
  if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
    return {
      message: errorMessage,
      isRetryable: false,
      shouldShowUser: true,
      logLevel: 'warn',
    };
  }

  // Erro genérico
  return {
    message: `Erro ao ${context}. Tente novamente.`,
    isRetryable: true,
    shouldShowUser: true,
    logLevel: 'error',
  };
};

export const logError = (error: any, context: string, errorInfo: ErrorInfo) => {
  const logData = {
    timestamp: new Date().toISOString(),
    context,
    error: error?.message || error?.toString(),
    stack: error?.stack,
    errorInfo,
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
  };

  switch (errorInfo.logLevel) {
    case 'info':
      console.info('Error Info:', logData);
      break;
    case 'warn':
      console.warn('Error Warning:', logData);
      break;
    case 'error':
      console.error('Error:', logData);
      break;
  }

  // Em produção, você pode enviar para um serviço de logging
  // sendToLoggingService(logData);
};
