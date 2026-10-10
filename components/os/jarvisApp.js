// The Jarvis app's registry entry, kept OUT of apps.js on purpose.
//
// apps.js is in every visitor's bundle. This module is imported by DesktopOS
// only after useAdminGate says the owner is signed in, so for anyone else the
// entry, its name and the dynamic import of the app itself never reach the
// browser at all. Nothing here names the agent server's address.
import dynamic from "next/dynamic";
import { MonitorDot } from "lucide-react";

const Jarvis = dynamic(() => import("./apps/Jarvis"), { ssr: false });

export const JARVIS_APP = {
  id: "jarvis",
  name: "Jarvis",
  tag: "agent server · owner only",
  icon: MonitorDot,
  accent: "#FFB020",
  w: 1280,
  h: 820,
  large: true, // opens at most of the viewport, not at w × h
  dark: true, // the console palette, in both site themes
  singleton: true, // one socket to the box at a time
  Component: Jarvis,
};

export default JARVIS_APP;
