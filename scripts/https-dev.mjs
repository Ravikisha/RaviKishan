// An HTTPS front door for `next dev`, so an OAuth provider that refuses
// http:// redirects can still be connected from a laptop.
//
// WHY THIS EXISTS
// ---------------
// Instagram is the only provider here that will not register an http://
// redirect URI AT ALL — not even for localhost. Meta answers "Error saving
// OAuth redirect URIs" and refuses the whole save. So the consent screen can
// never come back to a plain `next dev`, and the attempt dies as
// "Invalid Request: Request parameters are invalid: Invalid redirect_uri",
// which reads like a misconfiguration rather than a protocol rule.
//
// `https://localhost:3443` IS accepted. This proxy is what makes that address
// real: it terminates TLS with a self-signed certificate and forwards to the
// dev server, setting `x-forwarded-proto: https` so `redirectUriFor()` builds
// an https:// callback rather than guessing from the socket it is reading.
//
//   npm run dev        # terminal 1, the usual Next dev server on 3000
//   npm run dev:https  # terminal 2, this, on 3443
//   open https://localhost:3443/admin?tab=accounts
//
// The certificate is self-signed, so the browser warns once. That is expected
// — it is a local certificate for a local hostname, and it is regenerated
// rather than committed.
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const certDir = path.resolve(here, "..", ".https-dev");
const keyFile = path.join(certDir, "localhost-key.pem");
const certFile = path.join(certDir, "localhost-cert.pem");

const TARGET_PORT = Number(process.env.DEV_PORT || 3000);
const LISTEN_PORT = Number(process.env.HTTPS_PORT || 3443);

/* ---------------- the certificate ---------------- */

// Generated on first run rather than committed: a private key in the
// repository is a private key in everyone's clone, and this one is worth
// nothing outside this machine.
function ensureCert() {
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) return;
  fs.mkdirSync(certDir, { recursive: true });

  // subjectAltName is not optional — every modern browser ignores the common
  // name and will refuse a certificate without a matching SAN entry.
  const cnf = path.join(certDir, "openssl.cnf");
  fs.writeFileSync(
    cnf,
    [
      "[req]",
      "distinguished_name = dn",
      "x509_extensions = v3_req",
      "prompt = no",
      "[dn]",
      "CN = localhost",
      "[v3_req]",
      "subjectAltName = @alt",
      "basicConstraints = CA:FALSE",
      "keyUsage = digitalSignature, keyEncipherment",
      "extendedKeyUsage = serverAuth",
      "[alt]",
      "DNS.1 = localhost",
      "IP.1 = 127.0.0.1",
      "IP.2 = ::1",
      "",
    ].join("\n")
  );

  try {
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-sha256",
        "-days", "825", "-nodes",
        "-keyout", keyFile, "-out", certFile,
        "-config", cnf,
      ],
      { stdio: "pipe" }
    );
  } catch (e) {
    console.error(
      "Could not generate a certificate with openssl.\n" +
        "Install OpenSSL (Git for Windows ships it) and run this again.\n" +
        String(e.stderr || e.message)
    );
    process.exit(1);
  }
  console.log(`certificate written to ${path.relative(process.cwd(), certDir)}`);
}

/* ---------------- the proxy ---------------- */

ensureCert();

const server = https.createServer(
  { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
  (req, res) => {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: TARGET_PORT,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          // What the app reads to build an https:// redirect. Without these
          // two the consent would be served over TLS and the callback built
          // as http://, which is the exact failure this script exists for.
          "x-forwarded-proto": "https",
          "x-forwarded-host": `localhost:${LISTEN_PORT}`,
          host: `localhost:${TARGET_PORT}`,
        },
      },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      }
    );

    upstream.on("error", (err) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(
        `The dev server on :${TARGET_PORT} is not answering (${err.code}).\n` +
          "Start it with `npm run dev` in another terminal.\n"
      );
    });

    req.pipe(upstream);
  }
);

// Next's hot reload runs over a WebSocket; without this the page loads and
// then never updates, which looks like the proxy breaking the app.
server.on("upgrade", (req, socket, head) => {
  const upstream = http.request({
    host: "127.0.0.1",
    port: TARGET_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: `localhost:${TARGET_PORT}` },
  });
  upstream.on("upgrade", (upRes, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(upRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n") +
        "\r\n\r\n"
    );
    if (upHead?.length) socket.unshift(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  upstream.on("error", () => socket.destroy());
  if (head?.length) upstream.write(head);
  upstream.end();
});

server.listen(LISTEN_PORT, () => {
  console.log(`https://localhost:${LISTEN_PORT}  ->  http://localhost:${TARGET_PORT}`);
  console.log("The certificate is self-signed; accept the browser warning once.");
  console.log(`Connect Instagram at https://localhost:${LISTEN_PORT}/admin?tab=accounts`);
});
