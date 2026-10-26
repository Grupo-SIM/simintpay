import { Suspense } from 'react';
import { TelegramSuccessContent } from '@/components/telegram-success';

const SuccessPage = () => {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="animate-pulse text-center">
            <div className="h-20 w-20 bg-gray-200 rounded-full mx-auto mb-4" />
            <div className="h-6 w-48 bg-gray-200 rounded mx-auto mb-3" />
            <div className="h-4 w-64 bg-gray-200 rounded mx-auto" />
          </div>
        </div>
      }
    >
      <TelegramSuccessContent />
    </Suspense>
  );
};

export default SuccessPage;
