"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="wrap">
      <div className="empty card" style={{ marginTop: 40 }} role="alert">
        <h3>Something broke on our side</h3>
        <p>Your bookings and payments are safe. Try again in a moment.</p>
        <button className="btn" onClick={reset}>Try again</button>
      </div>
    </div>
  );
}
