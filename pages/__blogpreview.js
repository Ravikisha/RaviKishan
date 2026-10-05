// Design reference for the blog post page, rendered with the real PostView so
// it can never drift from the live article layout. Open /__blogpreview in dev.
//
// 404s in production: it is a design tool, not a page.
import React from "react";
import PostView from "../components/blog/PostView";

const body = `Most container tutorials start with \`docker run\`. That is the wrong end of the telescope. A container is not a thing the kernel knows about — it is a process wearing a costume made of namespaces, cgroups and a pivoted root. Once you see that, the whole abstraction stops being magic.

I wanted to prove it to myself, so I wrote one in about 200 lines of Go.

## What a container actually is

There is no container object anywhere in Linux. When you start one, three separate kernel features get composed:

- **namespaces** decide what the process can *see* — its own PID 1, its own network stack, its own mount table
- **cgroups** decide what it can *use* — memory, CPU, PIDs
- **pivot_root** decides what its filesystem *is*

Nothing binds them together. The "container" is the convention that you always apply all three at once.

> The kernel has no idea your container exists. It only knows about a process with unusual flags.

## Unsharing the namespaces

Go makes this unusually pleasant, because \`SysProcAttr\` exposes the clone flags directly:

\`\`\`go
cmd := exec.Command("/proc/self/exe", append([]string{"child"}, args...)...)
cmd.SysProcAttr = &syscall.SysProcAttr{
    Cloneflags: syscall.CLONE_NEWUTS | // hostname
        syscall.CLONE_NEWPID | // process ids
        syscall.CLONE_NEWNS | // mounts
        syscall.CLONE_NEWNET | // network
        syscall.CLONE_NEWIPC, // ipc
    Unshareflags: syscall.CLONE_NEWNS,
}
cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
\`\`\`

Re-executing \`/proc/self/exe\` is the trick that makes this readable. The parent sets the flags; the child wakes up already inside the new namespaces and does the setup.

### Why PID 1 matters

Inside a new PID namespace the first process becomes PID 1, which inherits a real responsibility: reaping orphans. Skip it and the container slowly fills with zombies.

## Capping resources with cgroups v2

cgroups are a filesystem, which means configuring them is just writing files:

\`\`\`bash
mkdir /sys/fs/cgroup/mini
echo "100M" > /sys/fs/cgroup/mini/memory.max
echo "20"   > /sys/fs/cgroup/mini/pids.max
echo $PID   > /sys/fs/cgroup/mini/cgroup.procs
\`\`\`

That is the entire resource-limit story. No daemon, no API.

## What I got wrong

Two things cost me an evening each. \`pivot_root\` fails silently if the new root is not a mount point — you need a bind mount of the directory onto itself first. And mounting \`/proc\` before entering the PID namespace gives you the host's processes, which looks like everything working until you run \`ps\`.

## Was it worth it

Every abstraction I use daily now has a floor I have actually stood on. When a pod misbehaves I reach for \`nsenter\` instead of guessing, and reading the runc source stopped feeling like reading someone else's language.

The code is on GitHub. It is not production software and it is not trying to be — it is a proof, written down.

## How the pieces fit

\`\`\`mermaid
flowchart LR
  A[exec.Command] --> B{Cloneflags}
  B --> C[CLONE_NEWPID]
  B --> D[CLONE_NEWNS]
  B --> E[CLONE_NEWNET]
  C --> F[pivot_root]
  D --> F
  E --> F
  F --> G[(container)]
\`\`\`

## What it costs

Each namespace is cheap on its own, but the cost compounds. If a single unshare costs $c$ and we compose $n$ of them, the startup cost is roughly:

$$T_{start} = T_{fork} + \\sum_{i=1}^{n} c_i + T_{pivot}$$

which in practice is dominated by $T_{pivot}$ — the filesystem work, not the kernel flags.

## Measured, not asserted

\`\`\`d3 height=300
const data = [
  { flag: "NEWUTS", ms: 0.4 },
  { flag: "NEWPID", ms: 0.6 },
  { flag: "NEWNS", ms: 1.1 },
  { flag: "NEWNET", ms: 18.2 },
  { flag: "NEWIPC", ms: 0.5 },
];
const w = el.clientWidth, h = 280, m = { top: 10, right: 14, bottom: 28, left: 70 };
const svg = d3.select(el).append("svg").attr("width", w).attr("height", h);
const x = d3.scaleLinear().domain([0, 20]).range([m.left, w - m.right]);
const y = d3.scaleBand().domain(data.map(d => d.flag)).range([m.top, h - m.bottom]).padding(0.25);
svg.append("g").attr("transform", "translate(0," + (h - m.bottom) + ")")
   .call(d3.axisBottom(x).ticks(5).tickFormat(d => d + "ms"));
svg.append("g").attr("transform", "translate(" + m.left + ",0)").call(d3.axisLeft(y));
svg.selectAll("rect").data(data).join("rect")
   .attr("x", x(0)).attr("y", d => y(d.flag)).attr("height", y.bandwidth())
   .attr("width", d => x(d.ms) - x(0)).attr("fill", "#FFB020");
svg.selectAll("text.v").data(data).join("text").attr("class", "v")
   .attr("x", d => x(d.ms) + 6).attr("y", d => y(d.flag) + y.bandwidth() / 2 + 4)
   .attr("font-size", 11).attr("fill", "#8b90a0").text(d => d.ms + "ms");
\`\`\`

The network namespace is two orders of magnitude more expensive than the rest put together. That is the whole performance story.

## A sketch, because why not

\`\`\`p5 height=260
let t = 0;
function setup() { createCanvas(windowWidth, 260); noStroke(); }
function draw() {
  background(255, 255, 255, 18);
  t += 0.02;
  for (let i = 0; i < 5; i++) {
    const x = width / 2 + Math.cos(t + i) * (60 + i * 26);
    const y = 130 + Math.sin(t * 1.3 + i) * 48;
    fill(255, 176, 32, 190 - i * 26);
    circle(x, y, 34 - i * 4);
  }
}
\`\`\``;

export default function Preview() {
  return (
    <PostView
      post={{
        slug: "container-runtime-from-scratch",
        title: "Building a container runtime from scratch",
        excerpt:
          "There is no container object in Linux. Just a process wearing namespaces, cgroups and a pivoted root — about 200 lines of Go to prove it.",
        body,
        tags: ["go", "linux", "systems", "containers"],
        publishedAt: "2026-09-18T09:00:00.000Z",
        readingTime: 9,
        devtoUrl: "https://dev.to/ravikishan/x",
        cover: "",
      }}
    />
  );
}

export async function getStaticProps() {
  if (process.env.NODE_ENV === "production") return { notFound: true };
  return { props: {} };
}
