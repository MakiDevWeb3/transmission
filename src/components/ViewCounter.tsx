import { useEffect, useState } from "react";

export default function ViewCounter() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const cached = sessionStorage.getItem("vc");
    if (cached) { setCount(Number(cached)); return; }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    fetch("https://api.counterapi.dev/v1/transmission-discord/views/up", { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.count === "number") {
          setCount(d.count);
          sessionStorage.setItem("vc", String(d.count));
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
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
