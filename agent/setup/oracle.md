# Getting the Oracle box

The parts only you can do, with the exact values to pick. About 25 minutes,
most of it waiting.

---

## 0. Before you start

You need: a payment card (Oracle verifies identity with it and does **not**
charge for Always Free resources), a phone number, and an email.

I cannot do this step — it involves card details and an identity check.

---

## 1. Sign up

<https://signup.cloud.oracle.com>

Two things that cause most of the pain later:

**Pick your home region carefully — it cannot be changed.** Choose the one
nearest you that has Ampere capacity. For India, `ap-mumbai-1` or
`ap-hyderabad-1`. Everything else is reversible; this is not.

**Ignore the "upgrade to Pay As You Go" prompts.** Always Free works on the
free account. Upgrading is also fine (it keeps the free resources free and
removes the idle-reclamation policy), but it is a decision, not a requirement.

---

## 2a. Create it from the CLI (recommended)

`provision-oci.mjs` does everything in §2 and §3 in one command: network,
a security list with **no** inbound rules (or SSH from your own IP only), the
newest Ubuntu 22.04 aarch64 image, the A1 shape at 4 OCPU / 24 GB, a 100 GB
boot volume, `cloud-init.yaml` as user-data — and then it keeps retrying
"Out of host capacity" across every availability domain until it gets a box.

**One-time: an API key for the CLI.** Ten minutes, in the console:

1. Install the CLI. Windows: `winget install Oracle.OCI-CLI` (or
   `pip install oci-cli`). macOS: `brew install oci-cli`. Linux:
   `bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"`.
2. Run `oci setup config`. It asks for:
   - **user OCID** — console → profile icon (top right) → *My profile* → copy
     the OCID.
   - **tenancy OCID** — profile icon → *Tenancy: …* → copy the OCID.
   - **region** — your home region, e.g. `ap-mumbai-1`.
   - generate a new key pair: **yes**. It writes `~/.oci/oci_api_key.pem`
     (private — never upload it anywhere) and `oci_api_key_public.pem`.
3. Console → *My profile* → **API keys** → *Add API key* → *Paste a public
   key* → paste the contents of `~/.oci/oci_api_key_public.pem`. The
   fingerprint it shows must match the one in `~/.oci/config`.
4. Check: `oci iam region list` prints a table. If it says
   `NotAuthenticated`, the fingerprint or the key upload is wrong.

**Then:**

```bash
# see every command it would run, without creating anything
node agent/setup/provision-oci.mjs --dry-run

# create it — SSH allowed only from where you are now
node agent/setup/provision-oci.mjs \
  --ssh-key ~/.ssh/id_ed25519.pub \
  --ssh-cidr "$(curl -s https://checkip.amazonaws.com)/32" \
  --max-minutes 360
```

| flag | default | |
|---|---|---|
| `--ssh-key` | `~/.ssh/id_ed25519.pub` | the PUBLIC key |
| `--ssh-cidr` | none | without it the box accepts **no** inbound connections — the tunnel needs none. `/0` is refused. |
| `--max-minutes` | 360 | how long to keep retrying for capacity |
| `--ocpus` / `--memory-gb` / `--boot-gb` | 4 / 24 / 100 | capped at the free allowance |
| `--profile` / `--config` | `DEFAULT` / `~/.oci/config` | |
| `--oci` | auto | path to the CLI if it is not `oci` or `python -m oci_cli` |

It is **idempotent**: every resource is found by name (`agentd-vcn`,
`agentd-igw`, `agentd-sl`, `agentd-subnet`, `agentd`) and reused. Running it
again with a different `--ssh-cidr` (or none, once the tunnel works) rewrites
the security list and nothing else. An instance named `agentd` that already
exists is reported, not duplicated.

Leave it running in a terminal; when it prints `Created`, skip to §4.

---

## 2. Create the instance (by hand, in the console)

Compute → Instances → **Create instance**.

| field | value | why |
|---|---|---|
| Name | `agentd` | |
| Image | **Ubuntu 22.04** (or 24.04) | the setup script targets Debian/Ubuntu |
| Shape | **VM.Standard.A1.Flex** | the Always Free ARM shape |
| OCPUs | **4** | the whole free allowance |
| Memory | **24 GB** | the whole free allowance |
| Boot volume | 100–200 GB | free up to 200 GB total |
| SSH keys | paste your public key | `cat ~/.ssh/id_ed25519.pub` |

Then **Show advanced options → Management → Cloud-init script**, and paste the
contents of `cloud-init.yaml` from this folder.

Leave networking alone. Do **not** open any ingress ports — nothing needs them.

---

## 3. When "Out of capacity" appears

It will. ARM capacity in free tenancies is genuinely scarce and this is the
single most common reason people give up.

Three things that work, in order of effort:

1. **Try a different availability domain.** The form has AD-1/AD-2/AD-3 in some
   regions; capacity differs per AD.
2. **Try again on a schedule.** Capacity frees up constantly. That is what
   `provision-oci.mjs` (§2a) does: every AD in turn, then a back-off of one to
   five minutes with jitter, until `--max-minutes`. Only capacity and
   throttling are retried — any other error stops it, because retrying a
   wrong image id for six hours helps nobody.
3. **Upgrade to Pay As You Go.** Free-tier ARM is allocated after paying
   tenancies. The Always Free resources stay free afterwards. This is the
   reliable fix, and it is why many people end up doing it.

If none of that works today, **start on a machine at home** — the whole stack is
identical, `setup.sh` runs the same, and Cloudflare Tunnel makes a home box
reachable at the same hostname. Move later.

---

## 4. Watch it provision

```bash
ssh ubuntu@<public-ip>
sudo tail -f /var/log/cloud-init-output.log
```

Roughly four minutes. It ends with a banner listing the two remaining steps.

---

## 5. The tunnel

```bash
cloudflared tunnel login          # opens a URL; approve for ravikishan.me
cloudflared tunnel create agentd  # prints a tunnel id
cloudflared tunnel route dns agentd agent.ravikishan.me

sudo tee /etc/cloudflared/config.yml >/dev/null <<EOF
tunnel: agentd
credentials-file: /home/ubuntu/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: agent.ravikishan.me
    service: http://127.0.0.1:7777
  - service: http_status:404
EOF

sudo cloudflared service install
sudo systemctl start cloudflared
```

Check from anywhere:

```bash
curl -s https://agent.ravikishan.me/health
# {"ok":true,"jobs":0,"halted":false}
```

---

## 6. Sign an account in

Once the tunnel is up, do this from the admin's **Agent** tab instead — paste
a `claude setup-token` token (or an OpenAI key for Codex), or press *Sign in*
and paste back the code the provider shows. Nothing below is needed then.

By hand, over SSH:

```bash
sudo -u agent -H env CLAUDE_CONFIG_DIR=/home/agent/.agentd/profiles/personal/claude \
  claude auth login
```

It prints a URL — open it in any browser, approve. Repeat with a different
profile directory for a second account:

```bash
sudo -u agent -H env CLAUDE_CONFIG_DIR=/home/agent/.agentd/profiles/work/claude \
  claude auth login
```

Codex, the same way with `CODEX_HOME`.

---

## 7. Credentials the jobs need

The agent clones and pushes as itself, so give it its own token — **not** the
OAuth token the site's GitHub integration holds.

```bash
sudo -u agent -H gh auth login      # choose HTTPS, paste a fine-grained PAT
```

Scope it to the repositories you actually want it touching. A token that can
reach every repo you own is the wrong blast radius for something that takes
instructions from a phone.

---

## 8. Verify

```bash
cd /opt/agentd/agent && npm run doctor
```

Expect: every tool found, directories `0700`, at least one profile signed in,
and `binding to 127.0.0.1`. If doctor reports binding to anything else, stop —
that means agentd is exposed directly rather than through the tunnel.

Then open the admin PWA → **Agent**. The dot goes green, and the first job
worth running is a harmless one:

> list the files in the repo and tell me what the test scripts do

with **Asks: everything** and **Finish: show me a diff**. Watch an approval
arrive on your phone before you trust it with a push.

---

## 9. Give jobs the site and memory

Mint an MCP token in the admin's **MCP** tab with `read` + `write` — never
`secrets`, never `agent` (a job holding `agent` could answer its own approval
cards) — and add it to `/etc/agentd.env`:

```
AGENT_MCP_TOKEN=rkmcp_...
```

`sudo systemctl restart agentd`. Every job then gets the site's MCP server in
its org (accounts, notes, posts), recalled memories are prepended to its
prompt, and its learnings are filed when it ends. Unset, jobs run without
either and nothing is sent anywhere.

---

## Set this in the site

The panel needs to know where the server is. In Vercel's environment:

```
NEXT_PUBLIC_AGENT_URL=wss://agent.ravikishan.me
```

It defaults to that already, so this only matters if you use a different
hostname.
