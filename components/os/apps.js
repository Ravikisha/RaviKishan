// App registry for the desktop window-manager. Add a new app = add an entry
// here; it automatically shows in the Dock + Spotlight and opens in a draggable,
// minimizable, maximizable window. `Component` renders inside the window body.
import dynamic from "next/dynamic";
import { Activity, Share2, Terminal, LineChart, FileText, GitBranch, Gauge, BadgeCheck, Newspaper, Mail, Layers, FolderGit2, User, BrainCircuit, Keyboard, Sparkles, Folder, NotebookPen, Image as ImageIcon, Music, Code2, CalendarClock, MessageCircle, Globe, FlaskConical, MailPlus } from "lucide-react";

const SystemMonitor = dynamic(() => import("../home2/SystemMonitor"), { ssr: false });
const KnowledgeGraph = dynamic(() => import("./apps/KnowledgeGraph"), { ssr: false });
const QuantLab = dynamic(() => import("../home2/QuantLab"), { ssr: false });
const Console = dynamic(() => import("./apps/Console"), { ssr: false });
const Resume = dynamic(() => import("./apps/Resume"), { ssr: false });
const DevTools = dynamic(() => import("./apps/DevTools"), { ssr: false });
const Certificates = dynamic(() => import("./apps/Certificates"), { ssr: false });
const Skills = dynamic(() => import("./apps/Skills"), { ssr: false });
const SkillInsights = dynamic(() => import("./apps/SkillInsights"), { ssr: false });
const Blog = dynamic(() => import("./apps/Blog"), { ssr: false });
const ContactApp = dynamic(() => import("./apps/Contact"), { ssr: false });
const AboutApp = dynamic(() => import("./apps/About"), { ssr: false });
const Projects = dynamic(() => import("./apps/Projects"), { ssr: false });
const Shortcuts = dynamic(() => import("./apps/Shortcuts"), { ssr: false });
const Welcome = dynamic(() => import("./apps/Welcome"), { ssr: false });
const Files = dynamic(() => import("./apps/Files"), { ssr: false });
const Notes = dynamic(() => import("./apps/Notes"), { ssr: false });
const Gallery = dynamic(() => import("./apps/Gallery"), { ssr: false });
const MusicApp = dynamic(() => import("./apps/Music"), { ssr: false });
const VSCode = dynamic(() => import("./apps/VSCode"), { ssr: false });
const CalendarApp = dynamic(() => import("./apps/Calendar"), { ssr: false });
const Chat = dynamic(() => import("./apps/Chat"), { ssr: false });
const Browser = dynamic(() => import("./apps/Browser"), { ssr: false });
const AILab = dynamic(() => import("./apps/AILab"), { ssr: false });
const MailApp = dynamic(() => import("./apps/Mail"), { ssr: false });

const APP_DEFS = [
  {
    id: "welcome",
    name: "Welcome",
    tag: "start here",
    icon: Sparkles,
    accent: "#FFB020",
    w: 600,
    h: 640,
    singleton: true, // one welcome window at a time
    Component: Welcome,
  },
  {
    id: "system-monitor",
    name: "System Monitor",
    tag: "btop · live",
    icon: Activity,
    accent: "#FFB020",
    w: 900,
    h: 600,
    dark: true, // app paints its own dark surface
    Component: SystemMonitor,
  },
  {
    id: "knowledge-graph",
    name: "Knowledge Graph",
    tag: "skills · connected",
    icon: Share2,
    accent: "#4ED0C0",
    w: 860,
    h: 580,
    dark: true, // graph is dark in both themes by design
    Component: KnowledgeGraph,
  },
  {
    id: "quant-lab",
    name: "Quant Desk",
    tag: "backtest · sim",
    icon: LineChart,
    accent: "#4ED0C0",
    w: 940,
    h: 640,
    Component: QuantLab,
  },
  {
    id: "ai-lab",
    name: "AI Lab",
    tag: "applied ai · live",
    icon: FlaskConical,
    accent: "#FFB020",
    w: 880,
    h: 660,
    singleton: true, // one lab window at a time
    Component: AILab,
  },
  {
    id: "resume",
    name: "Résumé",
    tag: "one-page · pdf",
    icon: FileText,
    accent: "#FFB020",
    w: 860,
    h: 720,
    singleton: true, // one résumé window at a time
    Component: Resume,
  },
  {
    id: "devtools",
    name: "DEV MODE",
    tag: "profiler · overlays",
    icon: Gauge,
    accent: "#34D399",
    w: 340,
    h: 460,
    dark: true,
    singleton: true, // one profiler window at a time
    Component: DevTools,
  },
  {
    id: "skills",
    name: "Skills",
    tag: "stack · 50+",
    icon: Layers,
    accent: "#A78BFA",
    w: 840,
    h: 600,
    Component: Skills,
  },
  {
    id: "skill-insights",
    name: "Skill Insights",
    tag: "neural net · confidence",
    icon: BrainCircuit,
    accent: "#4ED0C0",
    w: 820,
    h: 640,
    Component: SkillInsights,
  },
  {
    id: "certificates",
    name: "Certificates",
    tag: "verified · 40+",
    icon: BadgeCheck,
    accent: "#34D399",
    w: 820,
    h: 600,
    Component: Certificates,
  },
  {
    id: "blog",
    name: "Blog",
    tag: "writing · live",
    icon: Newspaper,
    accent: "#60A5FA",
    w: 900,
    h: 640,
    singleton: true, // one blog window at a time
    Component: Blog,
  },
  {
    id: "projects",
    name: "Projects",
    tag: "shipped · open-source",
    icon: FolderGit2,
    accent: "#FFB020",
    w: 960,
    h: 660,
    singleton: true, // one projects window at a time
    Component: Projects,
  },
  {
    id: "about",
    name: "About",
    tag: "who · why",
    icon: User,
    accent: "#4ED0C0",
    w: 820,
    h: 620,
    singleton: true, // one about window at a time
    Component: AboutApp,
  },
  {
    id: "contact",
    name: "Contact",
    tag: "say hello",
    icon: Mail,
    accent: "#FFB020",
    w: 640,
    h: 660,
    singleton: true, // one contact window at a time
    Component: ContactApp,
  },
  {
    id: "mail",
    name: "Mail",
    tag: "message me · direct",
    icon: MailPlus,
    accent: "#FFB020",
    w: 560,
    h: 640,
    singleton: true, // one compose window at a time
    Component: MailApp,
  },
  {
    id: "files",
    name: "Files",
    tag: "finder · browse",
    icon: Folder,
    accent: "#60A5FA",
    w: 820,
    h: 560,
    singleton: true,
    Component: Files,
  },
  {
    id: "notes",
    name: "Notes",
    tag: "manifesto · essays",
    icon: NotebookPen,
    accent: "#FBBF24",
    w: 760,
    h: 580,
    singleton: true,
    Component: Notes,
  },
  {
    id: "gallery",
    name: "Gallery",
    tag: "photo wall · lightbox",
    icon: ImageIcon,
    accent: "#F472B6",
    w: 880,
    h: 620,
    singleton: true,
    Component: Gallery,
  },
  {
    id: "music",
    name: "Music",
    tag: "youtube player · 20 tracks",
    icon: Music,
    accent: "#A78BFA",
    w: 520,
    h: 700,
    dark: true,
    singleton: true,
    Component: MusicApp,
  },
  {
    id: "calendar",
    name: "Calendar",
    tag: "clock · world times",
    icon: CalendarClock,
    accent: "#4ED0C0",
    w: 720,
    h: 600,
    dark: true,
    singleton: true, // one calendar window at a time
    Component: CalendarApp,
  },
  {
    id: "chat",
    name: "The Lobby",
    tag: "public chat · live",
    icon: MessageCircle,
    accent: "#F472B6",
    w: 560,
    h: 640,
    singleton: true, // one lobby window at a time
    Component: Chat,
  },
  {
    id: "shortcuts",
    name: "Shortcuts",
    tag: "keyboard · cheat sheet",
    icon: Keyboard,
    accent: "#818CF8",
    w: 560,
    h: 620,
    singleton: true, // one shortcuts window at a time
    desktopOnly: true, // no physical keyboard on phones — hide from the grid
    Component: Shortcuts,
  },
  {
    id: "vscode",
    name: "VS Code",
    tag: "ravikishan.me.code-workspace",
    icon: Code2,
    accent: "#4EC9B0",
    w: 1000,
    h: 680,
    dark: true,
    singleton: true, // one editor window at a time
    Component: VSCode,
  },
  {
    id: "browser",
    name: "Nova",
    tag: "browser · go anywhere",
    icon: Globe,
    accent: "#60A5FA",
    w: 1040,
    h: 700,
    dark: true,
    Component: Browser,
  },
  {
    id: "terminal",
    name: "Terminal",
    tag: "zsh · portfolio console",
    icon: Terminal,
    accent: "#28c840",
    w: 680,
    h: 460,
    dark: true,
    singleton: true, // only one terminal window at a time
    Component: Console,
  },
];

// Display priority for the Launchpad grid + Spotlight app results (dev mode).
// Highest-signal recruiter content first, systems-flair next, utilities last.
// Any app not listed falls to the end (in its defined order).
const PRIORITY = [
  "welcome",
  "projects", "resume", "about", "skills", "contact",   // core portfolio
  "blog", "notes", "certificates", "gallery", "mail",   // proof + story + reach out
  "knowledge-graph", "skill-insights", "ai-lab",        // skills + AI, visualized
  "system-monitor", "terminal", "browser", "vscode", "quant-lab", "files", "devtools", // systems flair
  "chat", "calendar", "music", "shortcuts",             // extras / utilities
];
const rank = (id) => { const i = PRIORITY.indexOf(id); return i < 0 ? PRIORITY.length : i; };

export const APPS = [...APP_DEFS].sort((a, b) => rank(a.id) - rank(b.id));

export const getApp = (id) => APPS.find((a) => a.id === id);
