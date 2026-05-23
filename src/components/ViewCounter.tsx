import { useEffect, useState } from "react";

export default function ViewCounter() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("https://api.counterapi.dev/v1/transmission-discord/views/up")
      .then((r) => r.json())
      .then((d) => { if (typeof d.count === "number") setCount(d.count); })
      .catch(() => {});
  }, []);

  if (count === null) return null;

  return (
    <div className="view-counter">
      <span className="view-dot" />
      <span className="view-count">{count.toLocaleString("fr-FR")}</span>
      <span className="view-label">vues</span>
    </div>
  );
}
