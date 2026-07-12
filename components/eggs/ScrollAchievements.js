import { useEffect } from "react";

// Steam-style "Achievement Unlocked" toasts as the visitor scrolls past key
// homepage sections. Fires each once, then reuses the Easter toast bus (the
// `egg` CustomEvent) so the visuals stay consistent. Renders nothing.
const ACHIEVEMENTS = [
  { id: "systems", icon: "🧩", sub: "Systems Explorer · +100 XP" },
  { id: "featured", icon: "🚀", sub: "Project Digger · +150 XP" },
  { id: "ai-lab", icon: "🤖", sub: "Pipeline Whisperer · +300 XP" },
];

export default function ScrollAchievements() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const fired = new Set();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting || fired.has(e.target.id)) return;
          fired.add(e.target.id);
          const a = ACHIEVEMENTS.find((x) => x.id === e.target.id);
          if (a)
            window.dispatchEvent(
              new CustomEvent("egg", {
                detail: { icon: a.icon, title: "Achievement Unlocked", sub: a.sub },
              })
            );
        });
      },
      { threshold: 0.4 }
    );
    ACHIEVEMENTS.forEach((a) => {
      const el = document.getElementById(a.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return null;
}
