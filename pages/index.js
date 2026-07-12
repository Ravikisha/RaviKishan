import React from "react";
import Seo from "../components/Seo";
import Hero from "../components/home2/Hero";
import StatStrip from "../components/home2/StatStrip";
import SystemsBuilt from "../components/home2/SystemsBuilt";
import FeaturedProjects from "../components/home2/FeaturedProjects";
import ExperienceTimeline from "../components/home2/ExperienceTimeline";
import Publications from "../components/home2/Publications";
import ClosingCTA from "../components/home2/ClosingCTA";
// QuantLab ("Quant Desk") and AILab ("AI Lab") are now dev-mode desktop apps
// only — removed from the page / recruiter mode. See components/os/apps.js.

const Home = () => {
  return (
    <>
      <Seo
        title="Ravi Kishan — Software Engineer · Distributed Systems & Applied AI"
        description="Ravi Kishan builds low-level infrastructure from first principles — a deterministic UI runtime, a language interpreter and a fault-tolerant datastore — plus production agentic-AI systems. Patent-holding open-source author."
        path="/"
      />

      <main className="rm-only-block bg-bg font-sans text-fg antialiased">
        <Hero />
        <StatStrip />
        <SystemsBuilt />
        <FeaturedProjects />
        <ExperienceTimeline />
        <Publications />
        <ClosingCTA />
      </main>
    </>
  );
};

export default Home;
