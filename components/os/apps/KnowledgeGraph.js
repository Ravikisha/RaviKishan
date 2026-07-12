import React from "react";
import Graph from "../../home2/KnowledgeGraph";

// Desktop-OS wrapper: renders the knowledge graph in `bare` mode so it fills the
// window body without its own section header or inner MacBar (the OS window
// already provides the title bar + traffic lights).
export default function KnowledgeGraphApp() {
  return <Graph bare />;
}
