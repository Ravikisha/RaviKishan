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

## 2. Create the instance

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
2. **Try again on a schedule.** Capacity frees up constantly. From any machine
   with the OCI CLI configured:

   ```bash
   # Retries every 2 minutes until one is created, then stops.
   until oci compute instance launch --from-json file://instance.json 2>/dev/null; do
     echo "$(date +%H:%M) out of capacity, retrying"; sleep 120
   done
   ```

   Build `instance.json` once with the console's "Save as stack / Copy as CLI"
   option so the shape and subnet are exactly what you chose.
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

## Set this in the site

The panel needs to know where the server is. In Vercel's environment:

```
NEXT_PUBLIC_AGENT_URL=wss://agent.ravikishan.me
```

It defaults to that already, so this only matters if you use a different
hostname.
