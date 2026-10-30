function MarqueeItem() {
  return (
    <>
      <span className="sim-marquee-txt sim-marquee-txt--fill">SIM INT PAY</span>
      <span className="sim-marquee-star" aria-hidden="true">
        ✦
      </span>
      <span className="sim-marquee-txt sim-marquee-txt--outline">
        SIM INT PAY
      </span>
      <span className="sim-marquee-star" aria-hidden="true">
        ✦
      </span>
      <span className="sim-marquee-txt sim-marquee-txt--fill">SIM INT PAY</span>
      <span className="sim-marquee-star" aria-hidden="true">
        ✦
      </span>
      <span className="sim-marquee-txt sim-marquee-txt--outline">
        SIM INT PAY
      </span>
      <span className="sim-marquee-star" aria-hidden="true">
        ✦
      </span>
    </>
  );
}

export function SimBrandMarquee() {
  return (
    <div className="sim-marquee">
      <div className="sim-marquee-track">
        <div className="sim-marquee-item">
          <MarqueeItem />
        </div>
        <div className="sim-marquee-item" aria-hidden="true">
          <MarqueeItem />
        </div>
      </div>
    </div>
  );
}
