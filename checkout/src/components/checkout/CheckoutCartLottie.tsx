'use client';

import Lottie from 'lottie-react';
import addToCartAnimation from '@/assets/lottie/add-to-cart.json';

type Props = {
  className?: string;
};

export function CheckoutCartLottie({ className }: Props) {
  return (
    <div
      className={
        className ??
        'mx-auto mb-1 flex w-full max-w-[160px] justify-center sm:max-w-[180px]'
      }
    >
      <Lottie
        animationData={addToCartAnimation}
        loop
        className="h-[120px] w-[120px] sm:h-[136px] sm:w-[136px]"
      />
    </div>
  );
}
