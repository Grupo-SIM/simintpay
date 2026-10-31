'use client';

import { useState, useSyncExternalStore } from 'react';
import { reviews } from './simintpay-landing-data';

function chunkReviews<T>(items: T[], size: number) {
  const slides: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    slides.push(items.slice(i, i + size));
  }
  return slides;
}

function ReviewCard({ review }: { review: (typeof reviews)[number] }) {
  return (
    <article className="sim-review-card">
      <div className="sim-review-stars" aria-hidden="true">
        <i className="fa-solid fa-star" />
        <i className="fa-solid fa-star" />
        <i className="fa-solid fa-star" />
        <i className="fa-solid fa-star" />
        <i className="fa-solid fa-star" />
      </div>
      <p className="sim-review-text">{review.text}</p>
      <div className="sim-review-author">
        <img src={review.avatar} alt="" className="sim-review-avatar" />
        <div>
          <div className="sim-review-name">{review.name}</div>
          <div className="sim-review-role">{review.role}</div>
        </div>
      </div>
    </article>
  );
}

export function SimReviewsCarousel() {
  const visibleCount = useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia('(max-width: 960px)');
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => (window.matchMedia('(max-width: 960px)').matches ? 1 : 3),
    () => 3,
  );
  const [activeSlide, setActiveSlide] = useState(0);
  const slides = chunkReviews(reviews, visibleCount);
  const lastSlide = Math.max(slides.length - 1, 0);
  if (activeSlide > lastSlide) setActiveSlide(lastSlide);

  return (
    <>
      <div className="sim-reviews-carousel-wrap">
        <div className="sim-reviews-carousel-glow" aria-hidden="true" />
        <div className="sim-reviews-carousel">
          <div
            className="sim-reviews-track"
            style={{ transform: `translateX(-${activeSlide * 100}%)` }}
          >
            {slides.map((slide, slideIndex) => (
              <div key={slideIndex} className="sim-reviews-slide">
                {slide.map((review) => (
                  <ReviewCard key={review.name} review={review} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sim-reviews-dots">
        {slides.map((_, index) => (
          <button
            key={index}
            type="button"
            className={`sim-reviews-dot${index === activeSlide ? ' sim-reviews-dot--active' : ''}`}
            aria-label={`Ir para slide ${index + 1}`}
            aria-current={index === activeSlide ? 'true' : undefined}
            onClick={() => setActiveSlide(index)}
          />
        ))}
      </div>
    </>
  );
}
