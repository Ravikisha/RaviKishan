import React from "react";
import { BrainCircuit } from "lucide-react";
import NeuralNetSkills from "../../home2/NeuralNetSkills";
import ConfidenceMeter from "../../home2/ConfidenceMeter";

// Bundles the two interactive skill visualisations that live on /skills in
// recruiter mode — the neural-net skill network + the "model confidence" meter
// — into one desktop app for dev mode.
export default function SkillInsights() {
  return (
    <div className="h-full overflow-y-auto bg-bg font-sans text-fg">
      <div className="flex items-center gap-2 border-b border-edge px-5 py-3">
        <BrainCircuit className="h-4 w-4 text-accentText" />
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-accentText">Skill insights</span>
        <span className="font-mono text-xs text-muted">neural network · confidence</span>
      </div>
      <NeuralNetSkills />
      <ConfidenceMeter />
    </div>
  );
}
