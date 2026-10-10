#!/usr/bin/env node
// Creates the Oracle Always Free box for agentd with the OCI CLI, and keeps
// asking until Oracle has ARM capacity to give.
//
//   node agent/setup/provision-oci.mjs --ssh-key ~/.ssh/id_ed25519.pub --ssh-cidr 203.0.113.7/32
//   node agent/setup/provision-oci.mjs --dry-run          # print every command, run nothing
//
// What it makes, all in the tenancy root compartment, all named so a second
// run REUSES rather than duplicates:
//
//   agentd-vcn       10.0.0.0/16
//   agentd-igw       internet gateway — egress only matters, but a public
//                    subnet's egress goes through one
//   agentd-sl        security list: all egress; ingress ONLY tcp/22 from
//                    --ssh-cidr, and nothing at all without it
//   agentd-subnet    10.0.0.0/24, attached to agentd-sl ONLY — the VCN's
//                    default list (which opens 22 to the whole internet) is
//                    deliberately not attached
//   agentd           VM.Standard.A1.Flex, 4 OCPU / 24 GB, 100 GB boot,
//                    Ubuntu 22.04 aarch64, cloud-init = cloud-init.yaml
//
// Nothing listens publicly once it is up: agentd binds 127.0.0.1 and
// Cloudflare Tunnel connects OUTWARD. SSH from your own address is the only
// door, and only for the first evening.
//
// "Out of host capacity" is the normal answer for free-tier ARM. The script
// tries every availability domain, then backs off and tries again, until
// --max-minutes. Every other error stops it at once — retrying a bad image id
// for six hours helps nobody.
//
// Requires the OCI CLI configured with an API key (see oracle.md §2a). It is
// found as `oci`, or `python3 -m oci_cli` / `python -m oci_cli`, or --oci.
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const NAMES = {
  vcn: "agentd-vcn",
  igw: "agentd-igw",
  sl: "agentd-sl",
  subnet: "agentd-subnet",
  instance: "agentd",
};

export const SHAPE = "VM.Standard.A1.Flex";

/* ---------------- pure parts, unit-tested ---------------- */

export function parseArgs(argv) {
  const o = {
    dryRun: false,
    sshKey: path.join(os.homedir(), ".ssh", "id_ed25519.pub"),
    sshCidr: "",
    maxMinutes: 360,
    ocpus: 4,
    memoryGb: 24,
    bootGb: 100,
    profile: "DEFAULT",
    config: path.join(os.homedir(), ".oci", "config"),
    compartment: "",
    cloudInit: path.join(HERE, "cloud-init.yaml"),
    oci: "",
    ubuntu: "22.04",
  };
  const take = (i) => {
    if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value.`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--dry-run": o.dryRun = true; break;
      case "--ssh-key": o.sshKey = take(i); i++; break;
      case "--ssh-cidr": o.sshCidr = take(i); i++; break;
      case "--max-minutes": o.maxMinutes = Number(take(i)); i++; break;
      case "--ocpus": o.ocpus = Number(take(i)); i++; break;
      case "--memory-gb": o.memoryGb = Number(take(i)); i++; break;
      case "--boot-gb": o.bootGb = Number(take(i)); i++; break;
      case "--profile": o.profile = take(i); i++; break;
      case "--config": o.config = take(i); i++; break;
      case "--compartment": o.compartment = take(i); i++; break;
      case "--cloud-init": o.cloudInit = take(i); i++; break;
      case "--oci": o.oci = take(i); i++; break;
      case "--ubuntu": o.ubuntu = take(i); i++; break;
      case "-h":
      case "--help": o.help = true; break;
      default: throw new Error(`Unknown option ${a}. Try --help.`);
    }
  }
  if (o.sshCidr && !isCidr(o.sshCidr)) throw new Error(`--ssh-cidr "${o.sshCidr}" is not an IPv4 CIDR like 203.0.113.7/32.`);
  // 0.0.0.0/0 is what the default security list already does, and the
  // reason this script does not attach it.
  if (o.sshCidr && /\/0$/.test(o.sshCidr)) throw new Error("--ssh-cidr /0 opens SSH to the whole internet. Give your own address, /32.");
  if (!(o.ocpus >= 1 && o.ocpus <= 4)) throw new Error("--ocpus must be 1–4 (the Always Free allowance is 4).");
  if (!(o.memoryGb >= 1 && o.memoryGb <= 24)) throw new Error("--memory-gb must be 1–24 (the Always Free allowance is 24).");
  if (!(o.bootGb >= 50 && o.bootGb <= 200)) throw new Error("--boot-gb must be 50–200 (free up to 200 GB in total).");
  if (!(o.maxMinutes > 0)) throw new Error("--max-minutes must be positive.");
  return o;
}

// True when an argument is a dry run's stand-in for something not yet
// created ("<vcn-id>"). A READ naming one cannot run — OCI rejects the bogus
// OCID and the dry run used to die at the internet gateway on exactly the
// fresh tenancy it is meant to be tried on first — so it is printed, not run.
export const hasPlaceholder = (args) => (args || []).some((a) => /^<[^<>\s]+>$/.test(String(a)));

export const isCidr = (s) =>
  /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.test(s) &&
  s.split("/")[0].split(".").every((n) => Number(n) <= 255) &&
  Number(s.split("/")[1]) <= 32;

// The tenancy OCID for a profile in ~/.oci/config. INI, by hand: four keys
// matter and a parser dependency for them is not worth carrying.
export function tenancyFrom(configText, profile = "DEFAULT") {
  let current = "";
  for (const raw of String(configText).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      current = sec[1].trim();
      continue;
    }
    const kv = line.match(/^([A-Za-z_]+)\s*=\s*(.*)$/);
    if (kv && current === profile && kv[1] === "tenancy") return kv[2].trim();
  }
  return "";
}

// Oracle's two spellings of "no ARM left here right now", plus the throttle
// it answers when the retry is too eager. Everything else is a real error.
export const isCapacityError = (text) =>
  /out of host capacity|outofcapacity|out of capacity|InternalError.*capacity/i.test(String(text || ""));
export const isThrottle = (text) => /TooManyRequests|\b429\b/.test(String(text || ""));

// 60s, 90s, 135s… capped at five minutes, with ±20% jitter so two people
// running this script do not retry in lockstep against the same AD.
export function backoffMs(attempt, { rand = Math.random } = {}) {
  const base = Math.min(300_000, 60_000 * Math.pow(1.5, Math.max(0, attempt)));
  return Math.round(base * (0.8 + rand() * 0.4));
}

export function securityRules(sshCidr) {
  const egress = [{ destination: "0.0.0.0/0", protocol: "all", isStateless: false }];
  const ingress = sshCidr
    ? [{ source: sshCidr, protocol: "6", isStateless: false, tcpOptions: { destinationPortRange: { min: 22, max: 22 } } }]
    : [];
  return { egress, ingress };
}

// The newest Ubuntu image for the shape that is actually aarch64. The
// shape filter usually suffices; the name check is belt and braces, because
// an x86 image on an A1 shape fails late with an unhelpful error.
export function pickImage(images, version = "22.04") {
  const list = Array.isArray(images) ? images : [];
  return (
    list
      .filter((i) => String(i["operating-system-version"] || "").startsWith(version))
      .filter((i) => /aarch64/i.test(i["display-name"] || ""))
      .filter((i) => !/minimal/i.test(i["display-name"] || ""))
      .sort((a, b) => String(b["time-created"]).localeCompare(String(a["time-created"])))[0] || null
  );
}

// The `instance launch` argv. user_data is base64 of cloud-init.yaml, which
// is what OCI's metadata contract wants; --metadata carries both it and the
// SSH key so nothing depends on a temp file.
export function launchArgs({ ad, compartment, imageId, subnetId, sshPublicKey, userDataB64, ocpus, memoryGb, bootGb }) {
  return [
    "compute", "instance", "launch",
    "--availability-domain", ad,
    "--compartment-id", compartment,
    "--shape", SHAPE,
    "--shape-config", JSON.stringify({ ocpus, memoryInGBs: memoryGb }),
    "--image-id", imageId,
    "--subnet-id", subnetId,
    "--assign-public-ip", "true",
    "--display-name", NAMES.instance,
    "--boot-volume-size-in-gbs", String(bootGb),
    "--metadata", JSON.stringify({ ssh_authorized_keys: sshPublicKey.trim(), user_data: userDataB64 }),
    "--wait-for-state", "RUNNING",
    "--max-wait-seconds", "900",
  ];
}

/* ---------------- the CLI ---------------- */

const say = (s) => console.log(`\x1b[1;33m==>\x1b[0m ${s}`);

const redactArg = (a) => (a.startsWith("{") && a.includes("user_data") ? '{"ssh_authorized_keys":"…","user_data":"<base64 cloud-init>"}' : a);

function exec(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: String(stdout || ""), err: String(stderr || "") + (err && !stderr ? err.message : "") });
    });
  });
}

async function findOci(explicit) {
  const candidates = explicit
    ? [[explicit, []]]
    : [["oci", []], ["python3", ["-m", "oci_cli"]], ["python", ["-m", "oci_cli"]], ["py", ["-m", "oci_cli"]]];
  for (const [bin, pre] of candidates) {
    const r = await exec(bin, [...pre, "--version"]);
    if (r.code === 0) return { bin, pre, version: r.out.trim() };
  }
  return null;
}

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 32).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return 0;
  }

  let oci = await findOci(o.oci);
  if (!oci) {
    if (!o.dryRun) {
      console.error("The OCI CLI was not found. Install it (oracle.md §2a) or pass --oci <path>.");
      return 1;
    }
    oci = { bin: "oci", pre: [], version: "(not installed — dry run)" };
  }
  say(`OCI CLI ${oci.version}`);

  const cfgText = fs.existsSync(o.config) ? fs.readFileSync(o.config, "utf8") : "";
  const tenancy = o.compartment || tenancyFrom(cfgText, o.profile) || (o.dryRun ? "<tenancy-ocid>" : "");
  if (!tenancy) {
    console.error(`No tenancy in ${o.config} [${o.profile}]. Run \`oci setup config\` first, or pass --compartment.`);
    return 1;
  }

  // Every call goes through here, so --dry-run is the whole truth: it prints
  // exactly the argv that would run, and runs none of the MUTATING ones.
  // Reads still run when the CLI is there, so a dry run tells you what
  // already exists; without the CLI they print and return a placeholder.
  const call = async (args, { mutate = false, placeholder = null } = {}) => {
    const full = [...oci.pre, ...args, "--profile", o.profile, "--config-file", o.config];
    if (o.dryRun) console.log(`    $ ${oci.bin} ${full.map(redactArg).map((a) => (/\s|"/.test(a) ? `'${a}'` : a)).join(" ")}`);
    if (o.dryRun && (mutate || oci.version.includes("dry run") || hasPlaceholder(args))) return { ok: true, data: placeholder, dry: true };
    const r = await exec(oci.bin, full);
    if (r.code !== 0) return { ok: false, err: r.err || r.out };
    if (!r.out.trim()) return { ok: true, data: null };
    try {
      return { ok: true, data: JSON.parse(r.out).data ?? null };
    } catch (_) {
      return { ok: true, data: r.out };
    }
  };
  const must = async (args, opts) => {
    const r = await call(args, opts);
    if (!r.ok) throw new Error(`oci ${args.slice(0, 3).join(" ")} failed:\n${r.err.trim().slice(0, 1500)}`);
    return r.data;
  };
  const first = (data) => (Array.isArray(data) ? data[0] : null);

  const sshKeyText = fs.existsSync(o.sshKey) ? fs.readFileSync(o.sshKey, "utf8") : o.dryRun ? "ssh-ed25519 AAAA… you@host" : "";
  if (!sshKeyText) {
    console.error(`No SSH public key at ${o.sshKey}. Pass --ssh-key, or create one with ssh-keygen -t ed25519.`);
    return 1;
  }
  if (!/^(ssh-(ed25519|rsa)|ecdsa-sha2-)/.test(sshKeyText.trim())) {
    console.error(`${o.sshKey} does not look like a PUBLIC key. Point --ssh-key at the .pub file.`);
    return 1;
  }
  const userDataB64 = Buffer.from(fs.readFileSync(o.cloudInit, "utf8")).toString("base64");

  if (!o.sshCidr) say("No --ssh-cidr: the instance will accept NO inbound connections at all (the tunnel needs none).");

  // Reuse an existing instance before creating anything else.
  say(`Looking for an instance named ${NAMES.instance}`);
  const existing = (await must(["compute", "instance", "list", "--compartment-id", tenancy, "--display-name", NAMES.instance], { placeholder: [] })) || [];
  const live = (existing || []).find((i) => !["TERMINATED", "TERMINATING"].includes(i["lifecycle-state"]));
  if (live) {
    say(`Already exists (${live["lifecycle-state"]}): ${live.id}`);
    await reportIp(live.id);
    return 0;
  }

  say(`VCN ${NAMES.vcn}`);
  let vcn = first(await must(["network", "vcn", "list", "--compartment-id", tenancy, "--display-name", NAMES.vcn, "--lifecycle-state", "AVAILABLE"], { placeholder: [] }));
  if (!vcn) {
    vcn = await must(
      ["network", "vcn", "create", "--compartment-id", tenancy, "--display-name", NAMES.vcn, "--cidr-blocks", JSON.stringify(["10.0.0.0/16"]), "--dns-label", "agentd", "--wait-for-state", "AVAILABLE"],
      { mutate: true, placeholder: { id: "<vcn-id>", "default-route-table-id": "<route-table-id>" } }
    );
  }
  console.log(`    ${vcn.id}`);

  say(`Internet gateway ${NAMES.igw}`);
  let igw = first(await must(["network", "internet-gateway", "list", "--compartment-id", tenancy, "--vcn-id", vcn.id, "--display-name", NAMES.igw], { placeholder: [] }));
  if (!igw) {
    igw = await must(
      ["network", "internet-gateway", "create", "--compartment-id", tenancy, "--vcn-id", vcn.id, "--display-name", NAMES.igw, "--is-enabled", "true", "--wait-for-state", "AVAILABLE"],
      { mutate: true, placeholder: { id: "<igw-id>" } }
    );
  }
  // The default route table, pointed at the gateway. Rewriting it each run
  // is idempotent and corrects a hand-edited table.
  await must(
    ["network", "route-table", "update", "--rt-id", vcn["default-route-table-id"], "--route-rules", JSON.stringify([{ destination: "0.0.0.0/0", destinationType: "CIDR_BLOCK", networkEntityId: igw.id }]), "--force"],
    { mutate: true }
  );

  say(`Security list ${NAMES.sl} — ingress: ${o.sshCidr ? `tcp/22 from ${o.sshCidr}` : "none"}`);
  const rules = securityRules(o.sshCidr);
  let sl = first(await must(["network", "security-list", "list", "--compartment-id", tenancy, "--vcn-id", vcn.id, "--display-name", NAMES.sl], { placeholder: [] }));
  if (!sl) {
    sl = await must(
      ["network", "security-list", "create", "--compartment-id", tenancy, "--vcn-id", vcn.id, "--display-name", NAMES.sl, "--egress-security-rules", JSON.stringify(rules.egress), "--ingress-security-rules", JSON.stringify(rules.ingress), "--wait-for-state", "AVAILABLE"],
      { mutate: true, placeholder: { id: "<security-list-id>" } }
    );
  } else {
    // Re-applied every run, so changing --ssh-cidr (a new home IP, or none
    // once the tunnel works) is one command.
    await must(
      ["network", "security-list", "update", "--security-list-id", sl.id, "--egress-security-rules", JSON.stringify(rules.egress), "--ingress-security-rules", JSON.stringify(rules.ingress), "--force"],
      { mutate: true }
    );
  }

  say(`Subnet ${NAMES.subnet}`);
  let subnet = first(await must(["network", "subnet", "list", "--compartment-id", tenancy, "--vcn-id", vcn.id, "--display-name", NAMES.subnet], { placeholder: [] }));
  if (!subnet) {
    subnet = await must(
      ["network", "subnet", "create", "--compartment-id", tenancy, "--vcn-id", vcn.id, "--display-name", NAMES.subnet, "--cidr-block", "10.0.0.0/24", "--dns-label", "agentd", "--route-table-id", vcn["default-route-table-id"], "--security-list-ids", JSON.stringify([sl.id]), "--prohibit-public-ip-on-vnic", "false", "--wait-for-state", "AVAILABLE"],
      { mutate: true, placeholder: { id: "<subnet-id>" } }
    );
  } else if (!(subnet["security-list-ids"] || []).every((id) => id === sl.id)) {
    // An existing subnet still carrying the default list (SSH open to the
    // world) is corrected rather than reused as-is.
    await must(["network", "subnet", "update", "--subnet-id", subnet.id, "--security-list-ids", JSON.stringify([sl.id]), "--force"], { mutate: true });
  }

  say(`Image: Ubuntu ${o.ubuntu} aarch64 for ${SHAPE}`);
  const images = await must(
    ["compute", "image", "list", "--compartment-id", tenancy, "--operating-system", "Canonical Ubuntu", "--operating-system-version", o.ubuntu, "--shape", SHAPE, "--sort-by", "TIMECREATED", "--sort-order", "DESC", "--all"],
    { placeholder: [{ id: "<image-id>", "display-name": `Canonical-Ubuntu-${o.ubuntu}-aarch64-dry-run`, "operating-system-version": o.ubuntu, "time-created": "" }] }
  );
  const image = pickImage(images, o.ubuntu);
  if (!image) throw new Error(`No Ubuntu ${o.ubuntu} aarch64 image is offered for ${SHAPE} in this region.`);
  console.log(`    ${image["display-name"]}`);

  const ads = ((await must(["iam", "availability-domain", "list", "--compartment-id", tenancy], { placeholder: [{ name: "<AD-1>" }] })) || []).map((a) => a.name);
  if (!ads.length) throw new Error("No availability domains were listed for this tenancy.");
  say(`Availability domains: ${ads.join(", ")}`);

  const deadline = Date.now() + o.maxMinutes * 60_000;
  for (let attempt = 0; ; attempt++) {
    for (const ad of ads) {
      say(`Launch attempt ${attempt + 1} in ${ad}`);
      const r = await call(
        launchArgs({ ad, compartment: tenancy, imageId: image.id, subnetId: subnet.id, sshPublicKey: sshKeyText, userDataB64, ocpus: o.ocpus, memoryGb: o.memoryGb, bootGb: o.bootGb }),
        { mutate: true, placeholder: { id: "<instance-id>" } }
      );
      if (r.ok) {
        if (r.dry) {
          say("Dry run: stopping before the retry loop. Nothing was created.");
          return 0;
        }
        say(`Created ${r.data.id}`);
        await reportIp(r.data.id);
        return 0;
      }
      if (isCapacityError(r.err)) {
        console.log(`    out of host capacity in ${ad}`);
        continue;
      }
      if (isThrottle(r.err)) {
        console.log("    throttled by the API; backing off");
        break;
      }
      throw new Error(`Launch failed for a reason retrying will not fix:\n${r.err.trim().slice(0, 2000)}`);
    }
    if (Date.now() >= deadline) {
      console.error(`\nNo capacity in ${o.maxMinutes} minutes. Run it again later — or see oracle.md §3 for the options that always work.`);
      return 2;
    }
    const wait = backoffMs(attempt);
    console.log(`    every AD is full right now; next round in ${Math.round(wait / 1000)}s (gives up at ${new Date(deadline).toLocaleTimeString()})`);
    await new Promise((res) => setTimeout(res, wait));
  }

  async function reportIp(instanceId) {
    const vnics = await call(["compute", "instance", "list-vnics", "--instance-id", instanceId], { placeholder: [] });
    const ip = vnics.ok && Array.isArray(vnics.data) ? vnics.data.map((v) => v["public-ip"]).find(Boolean) : "";
    console.log(`
    instance   ${instanceId}
    public ip  ${ip || "(none yet — check the console)"}

    It provisions itself from cloud-init in about four minutes:
      ssh ubuntu@${ip || "<ip>"} 'sudo tail -f /var/log/cloud-init-output.log'

    Then the tunnel and a sign-in — oracle.md §5 and §6, or from the admin's
    Agent tab once the tunnel is up.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
    .then((code) => process.exit(code || 0))
    .catch((e) => {
      console.error(`\n${e.message}`);
      process.exit(1);
    });
}
