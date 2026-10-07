// The NEXT_PUBLIC_ variables, for the browser, at run time.
//
// Next.js normally compiles NEXT_PUBLIC_ values into the bundle at BUILD time,
// which would put them back in Vercel. Here they live in the database like
// everything else, so the browser asks for them instead. Only NEXT_PUBLIC_
// keys are ever returned — public by their own name, already visible to every
// visitor of a site that uses them.
import { publicValues, withEnv } from "../../lib/server/envStore";

async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET." });
  }
  // Short, shared cache: a change made in the admin reaches visitors within a
  // minute without every page view costing a database read.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  return res.status(200).json(publicValues());
}

export default withEnv(handler);
