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

The code is on GitHub. It is not production software and it is not trying to be — it is a proof, written down.`;

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
