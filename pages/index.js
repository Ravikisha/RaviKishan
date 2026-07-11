import React from "react";
import Head from "next/head";
import Hero from "../components/home2/Hero";
import StatStrip from "../components/home2/StatStrip";
import SystemsBuilt from "../components/home2/SystemsBuilt";
import FeaturedProjects from "../components/home2/FeaturedProjects";
import ExperienceTimeline from "../components/home2/ExperienceTimeline";
import ClosingCTA from "../components/home2/ClosingCTA";

const Home = () => {
  return (
    <>
      <Head>
        <title>Ravi Kishan — Software Engineer · Distributed Systems &amp; Applied AI</title>
        <meta
          name="description"
          content="Ravi Kishan builds low-level infrastructure from first principles — a deterministic UI runtime, a language interpreter and a fault-tolerant datastore — plus production agentic-AI systems. Patent-holding open-source author."
        />
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>

      <main className="bg-bg font-sans text-fg antialiased">
        <Hero />
        <StatStrip />
        <SystemsBuilt />
        <FeaturedProjects />
        <ExperienceTimeline />
        <ClosingCTA />
      </main>
    </>
  );
};

export default Home;
